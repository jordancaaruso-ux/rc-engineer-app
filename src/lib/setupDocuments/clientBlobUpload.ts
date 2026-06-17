import { upload } from "@vercel/blob/client";

import { SETUP_DOCUMENT_MAX_BYTES } from "@/lib/setupDocuments/types";

/** Match `storeSetupDocumentFile` naming: `setup-documents/YYYY-MM-DD-<uuid><ext>`. */
export function buildSetupDocumentBlobPathname(originalName: string): string {
  const rawExt = (originalName.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const safeExt = rawExt && rawExt.length <= 8 ? rawExt : "";
  const date = new Date().toISOString().slice(0, 10);
  return `setup-documents/${date}-${crypto.randomUUID()}${safeExt}`;
}

/**
 * Stream a setup file directly to Vercel Blob (bypasses the ~4.5MB serverless body limit).
 * Requires `BLOB_READ_WRITE_TOKEN` and `/api/setup-documents/client-upload`.
 */
export async function uploadSetupDocumentViaClientBlob(
  file: File,
  opts?: { signal?: AbortSignal }
): Promise<{ storagePath: string }> {
  if (file.size > SETUP_DOCUMENT_MAX_BYTES) {
    throw new Error("File too large (max 12 MB).");
  }
  const pathname = buildSetupDocumentBlobPathname(file.name);
  const blob = await upload(pathname, file, {
    access: "private",
    handleUploadUrl: "/api/setup-documents/client-upload",
    abortSignal: opts?.signal,
    contentType: file.type?.trim() || undefined,
    multipart: file.size > 5 * 1024 * 1024,
  });
  return { storagePath: blob.url };
}
