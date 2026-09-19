import { uploadSetupDocumentViaClientBlob } from "@/lib/setupDocuments/clientBlobUpload";
import { SETUP_UPLOAD_SERVERLESS_SAFE_BYTES } from "@/lib/setupDocuments/uploadLimits";

/**
 * Send a blank manufacturer setup sheet to `POST /api/setup-sheet-models/blank` and get a chassis
 * back.
 *
 * Mirrors `setupDocumentUploadClient`: anything over the serverless body limit is streamed straight
 * to Blob by the browser first, then the route is handed the path instead of the bytes. The two
 * real Xray blanks are 1.8 MB and 1.1 MB so most uploads take the simple road, but sheets do exist
 * that do not, and a 413 is an unexplainable failure to the person holding the phone.
 *
 * The same call handles a finished sheet and a manufacturer's blank. Whatever was in the boxes
 * comes back as `values`, and the caller saves it once the car exists.
 */

export type BlankUploadModel = {
  id: string;
  name: string;
  slug: string;
  isAuthorized: boolean;
};

export type BlankUploadResult =
  | {
      ok: true;
      model: BlankUploadModel;
      unnamedBoxes: number;
      totalBoxes: number;
      /**
       * This exact sheet was already in the catalog, so the driver joined that chassis instead of
       * making a second one. Worth saying out loud: they typed a name and got a different one back.
       */
      merged: boolean;
      /**
       * What was already in the boxes. Saved as the car's first setup once the car exists, which
       * is why it travels back to the client rather than being written server-side.
       */
      values: Record<string, unknown>;
      filledCount: number;
    }
  | {
      ok: false;
      error: string;
      /**
       * True when the file was plausibly their real sheet and we simply could not read it. The
       * panel then offers to add the car with no sheet, which is the old behaviour and still the
       * right landing place — they came here to add a car, not to debug a PDF.
       */
      offerCarWithoutSheet: boolean;
    };

type BlankUploadResponse = {
  model?: BlankUploadModel;
  stats?: { parameterCount?: number; placeholderLabelCount?: number } | null;
  merged?: boolean;
  values?: Record<string, unknown>;
  filledCount?: number;
  error?: string;
  offerCarWithoutSheet?: boolean;
};

export async function uploadBlankSheetForChassis(
  file: File,
  chassisName: string,
  /**
   * An encoded discipline (`carClasses.ts`): class + power. Required, and positional rather than
   * an option, so a caller cannot
   * forget it and get a chassis that never says what it races — the route refuses the derive
   * door without one anyway, and a 400 after the upload is a worse way to find out.
   */
  discipline: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<BlankUploadResult> {
  const name = chassisName.trim();
  if (!name) return { ok: false, error: "Give the chassis a name first.", offerCarWithoutSheet: false };
  const platform = discipline.trim();
  if (!platform) {
    return { ok: false, error: "Pick what this chassis races first.", offerCarWithoutSheet: false };
  }

  // Deriving a 289-box sheet takes noticeably longer than storing a file, and a phone on track
  // wifi is the normal case, so this is more generous than the plain document upload's 60s.
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const outer = opts?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    if (file.size > SETUP_UPLOAD_SERVERLESS_SAFE_BYTES) {
      const { storagePath } = await uploadSetupDocumentViaClientBlob(file, { signal: controller.signal });
      res = await fetch("/api/setup-sheet-models/blank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          discipline: platform,
          derive: true,
          storagePath,
          originalFilename: file.name,
          mimeType: file.type || "application/pdf",
          byteSize: file.size,
        }),
        signal: controller.signal,
      });
    } else {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("discipline", platform);
      fd.set("derive", "1");
      fd.set("pdf", file);
      res = await fetch("/api/setup-sheet-models/blank", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
    }

    const data = (await res.json().catch(() => ({}))) as BlankUploadResponse;
    if (!res.ok || !data.model) {
      return {
        ok: false,
        error: data.error?.trim() || `Upload failed (${res.status})`,
        offerCarWithoutSheet: data.offerCarWithoutSheet === true,
      };
    }
    return {
      ok: true,
      model: data.model,
      totalBoxes: data.stats?.parameterCount ?? 0,
      unnamedBoxes: data.stats?.placeholderLabelCount ?? 0,
      merged: data.merged === true,
      values: data.values ?? {},
      filledCount: data.filledCount ?? 0,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "That took too long. Check your connection and try again."
        : e instanceof Error
          ? e.message
          : "Upload failed.",
      // A network failure says nothing about the sheet, so do not push them off the sheet path.
      offerCarWithoutSheet: false,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
