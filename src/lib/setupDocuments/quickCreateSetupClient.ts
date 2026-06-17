/**
 * Client helpers for `POST /api/setup-documents/quick-create`.
 * Used by Setup page upload and Log your run quick-import.
 */

import { uploadSetupDocumentViaClientBlob } from "@/lib/setupDocuments/clientBlobUpload";
import { SETUP_UPLOAD_SERVERLESS_SAFE_BYTES } from "@/lib/setupDocuments/uploadLimits";

export const QUICK_CREATE_SETUP_ACCEPT_MIME =
  "application/pdf,image/jpeg,image/png,image/webp" as const;

export type QuickCreateCarCandidate = { id: string; name: string };

export type QuickCreateSetupResponse = {
  documentId: string;
  setupId: string | null;
  calibrationId: string | null;
  calibrationName: string | null;
  pickSource: "exact_fingerprint" | "ambiguous_suggestion" | "none";
  pickDebug: string;
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "FAILED";
  needsReview: boolean;
  needsReviewReason: string | null;
  calibrationAmbiguous: boolean;
  pickUserNote?: string | null;
  calibrationModelMismatch?: boolean;
  /** Chassis auto-detected from the sheet's fingerprint (global match). */
  detectedModelId?: string | null;
  detectedModelName?: string | null;
  /** When >1 of the uploader's cars share the detected chassis, they must pick one. */
  carCandidates?: QuickCreateCarCandidate[];
  /** No calibration anywhere matched this sheet's layout. */
  notRecognized?: boolean;
};

export type PostQuickCreateSetupResult =
  | { ok: true; data: QuickCreateSetupResponse }
  | { ok: false; status: number; error: string };

export type QuickCreateSetupTarget = {
  /** Preferred: chassis / setup sheet model (one per car type). */
  setupSheetModelId?: string;
  /** Optional: link to a specific car when model is omitted. */
  carId?: string;
};

function uploadErrorMessage(status: number, fallback?: string): string {
  if (status === 413) {
    return "File too large for direct upload. Try again — the app should stream large files automatically.";
  }
  return fallback?.trim() || `Upload failed (${status})`;
}

function parseQuickCreateResponse(
  data: Partial<QuickCreateSetupResponse> & { error?: string }
): QuickCreateSetupResponse | null {
  if (!data.documentId) return null;
  return {
    documentId: data.documentId,
    setupId: data.setupId ?? null,
    calibrationId: data.calibrationId ?? null,
    calibrationName: data.calibrationName ?? null,
    pickSource: data.pickSource ?? "none",
    pickDebug: typeof data.pickDebug === "string" ? data.pickDebug : "",
    parseStatus: (data.parseStatus as QuickCreateSetupResponse["parseStatus"]) ?? "PENDING",
    needsReview: Boolean(data.needsReview),
    needsReviewReason: data.needsReviewReason ?? null,
    calibrationAmbiguous: Boolean(data.calibrationAmbiguous),
    pickUserNote: data.pickUserNote ?? null,
    calibrationModelMismatch: Boolean(data.calibrationModelMismatch),
    detectedModelId: data.detectedModelId ?? null,
    detectedModelName: data.detectedModelName ?? null,
    carCandidates: Array.isArray(data.carCandidates) ? data.carCandidates : [],
    notRecognized: Boolean(data.notRecognized),
  };
}

export async function postQuickCreateSetup(
  file: File,
  target: QuickCreateSetupTarget = {},
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<PostQuickCreateSetupResult> {
  const modelId = target.setupSheetModelId?.trim();
  const carId = target.carId?.trim();
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const outer = opts?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const useClientBlob = file.size > SETUP_UPLOAD_SERVERLESS_SAFE_BYTES;

    if (useClientBlob) {
      const { storagePath } = await uploadSetupDocumentViaClientBlob(file, {
        signal: controller.signal,
      });
      const res = await fetch("/api/setup-documents/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          originalFilename: file.name,
          mimeType: file.type,
          ...(modelId ? { setupSheetModelId: modelId } : {}),
          ...(carId ? { carId } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<QuickCreateSetupResponse> & {
        error?: string;
      };
      const parsed = parseQuickCreateResponse(data);
      if (!res.ok || !parsed) {
        return {
          ok: false,
          status: res.status,
          error: uploadErrorMessage(res.status, data.error),
        };
      }
      return { ok: true, data: parsed };
    }

    const fd = new FormData();
    fd.set("file", file);
    if (modelId) fd.set("setupSheetModelId", modelId);
    if (carId) fd.set("carId", carId);
    const res = await fetch("/api/setup-documents/quick-create", {
      method: "POST",
      body: fd,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<QuickCreateSetupResponse> & {
      error?: string;
    };
    const parsed = parseQuickCreateResponse(data);
    if (!res.ok || !parsed) {
      return {
        ok: false,
        status: res.status,
        error: uploadErrorMessage(res.status, data.error),
      };
    }
    return { ok: true, data: parsed };
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

/** First image/* file on the clipboard, if any. */
export function clipboardEventToImageFile(ev: { clipboardData: DataTransfer | null }): File | null {
  const items = ev.clipboardData?.items;
  if (!items?.length) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    const t = (f.type || "").toLowerCase();
    if (t.startsWith("image/")) return f;
  }
  return null;
}
