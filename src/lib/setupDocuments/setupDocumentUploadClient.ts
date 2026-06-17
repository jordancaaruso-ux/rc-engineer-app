/**
 * Client upload for `POST /api/setup-documents` (wizard, setup library).
 * Large files use direct Blob upload to avoid Vercel's ~4.5MB body limit.
 */

import { uploadSetupDocumentViaClientBlob } from "@/lib/setupDocuments/clientBlobUpload";
import { SETUP_UPLOAD_SERVERLESS_SAFE_BYTES } from "@/lib/setupDocuments/uploadLimits";

export type PostSetupDocumentFields = {
  carId: string;
  setupSheetModelId?: string;
};

export type PostSetupDocumentResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

function uploadErrorMessage(status: number, fallback?: string): string {
  if (status === 413) {
    return "File too large for direct upload — retrying via Blob should fix this. If it persists, try a smaller PDF.";
  }
  return fallback?.trim() || `Upload failed (${status})`;
}

export async function postSetupDocumentUpload(
  file: File,
  fields: PostSetupDocumentFields,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<PostSetupDocumentResult> {
  const carId = fields.carId.trim();
  if (!carId) return { ok: false, status: 400, error: "carId is required." };

  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const outer = opts?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelId = fields.setupSheetModelId?.trim();
    const useClientBlob = file.size > SETUP_UPLOAD_SERVERLESS_SAFE_BYTES;

    if (useClientBlob) {
      const { storagePath } = await uploadSetupDocumentViaClientBlob(file, {
        signal: controller.signal,
      });
      const res = await fetch("/api/setup-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          originalFilename: file.name,
          mimeType: file.type,
          carId,
          ...(modelId ? { setupSheetModelId: modelId } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        return {
          ok: false,
          status: res.status,
          error: uploadErrorMessage(res.status, data.error),
        };
      }
      return { ok: true, id: data.id };
    }

    const fd = new FormData();
    fd.set("file", file);
    fd.set("carId", carId);
    if (modelId) fd.set("setupSheetModelId", modelId);
    const res = await fetch("/api/setup-documents", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) {
      return {
        ok: false,
        status: res.status,
        error: uploadErrorMessage(res.status, data.error),
      };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: aborted ? "Upload timed out. Try again." : e instanceof Error ? e.message : "Upload failed.",
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
