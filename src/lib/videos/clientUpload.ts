import { upload } from "@vercel/blob/client";

/**
 * Browser-direct video upload: the file streams from the browser straight to Blob
 * storage (multipart, so a 1GB heat video uploads in parallel chunks with retries),
 * then a small JSON call registers the VideoAsset row. The server never parses the
 * body — the old FormData path failed locally on big files (`formData()` buffers the
 * whole request) and 413'd on Vercel (~4.5MB serverless body limit).
 */

/** Keep in sync with VIDEO_MAX_BYTES_DIRECT (server) — just under 2GB (Int column). */
export const VIDEO_UPLOAD_MAX_BYTES = 2000 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export async function uploadVideoToLibrary(
  file: File,
  opts?: {
    label?: string;
    runId?: string;
    trackId?: string;
    /** 0–100, called as the browser streams chunks to storage. */
    onProgress?: (percentage: number) => void;
  }
): Promise<{ id: string }> {
  const ext = (/\.[a-z0-9]+$/i.exec(file.name || "")?.[0] ?? "").toLowerCase();
  const mimeType = (file.type || MIME_BY_EXT[ext] || "").toLowerCase();
  if (!Object.values(MIME_BY_EXT).includes(mimeType)) {
    throw new Error("Unsupported video type. Use MP4/WebM/MOV.");
  }
  if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
    throw new Error("Video is too large (max 2GB). Film at 1080p, or trim the file.");
  }

  const safeExt = MIME_BY_EXT[ext] ? ext : mimeType === "video/webm" ? ".webm" : mimeType === "video/quicktime" ? ".mov" : ".mp4";
  const blob = await upload(`videos/${crypto.randomUUID()}${safeExt}`, file, {
    access: "private",
    handleUploadUrl: "/api/videos/client-upload",
    contentType: mimeType,
    multipart: true,
    onUploadProgress: opts?.onProgress
      ? (e) => opts.onProgress!(Math.round(e.percentage))
      : undefined,
  });

  const res = await fetch("/api/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: blob.url,
      filename: file.name || "upload",
      label: opts?.label,
      runId: opts?.runId,
      trackId: opts?.trackId,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !payload.id) {
    throw new Error(payload.error || `Saving the upload failed (${res.status})`);
  }
  return { id: payload.id };
}
