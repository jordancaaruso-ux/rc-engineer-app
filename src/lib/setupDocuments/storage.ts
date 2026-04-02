import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";

/**
 * Local disk fallback (development only — no `BLOB_READ_WRITE_TOKEN`).
 * Intentionally outside `public/` so Next/Vercel output file tracing does not bundle
 * uploaded PDFs into serverless functions (see `public/uploads` in repo).
 * DB values stay `/uploads/...`; resolve with `absolutePathForStoragePath`.
 */
const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), ".local-uploads");

/** When set, setup PDFs and cached run-rendered PDFs use Vercel Blob; otherwise `.local-uploads` (local dev). */
export function useBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function isRemoteStorageRef(ref: string): boolean {
  return /^https?:\/\//i.test(ref.trim());
}

export function sourceTypeFromMime(mimeType: string): "PDF" | "IMAGE" {
  return mimeType === "application/pdf" ? "PDF" : "IMAGE";
}

export async function storeSetupDocumentFile(file: File): Promise<{ storagePath: string }> {
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : "";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type?.trim() || "application/octet-stream";

  if (useBlobStorage()) {
    const blob = await put(`setup-documents/${filename}`, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { storagePath: blob.url };
  }

  const dir = path.join(LOCAL_UPLOAD_ROOT, "setup-documents");
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);
  const relativePath = `/uploads/setup-documents/${filename}`;
  await writeFile(absolutePath, bytes);
  return { storagePath: relativePath };
}

/** Persist lazily rendered run setup PDF; returns DB value for `Run.renderedSetupPdfPath` (URL or `/uploads/...`). */
export async function storeRunRenderedSetupPdf(runId: string, pdfBytes: Buffer): Promise<string> {
  const key = `run-setup-pdfs/${runId}.pdf`;
  if (useBlobStorage()) {
    const blob = await put(key, pdfBytes, {
      access: "public",
      contentType: "application/pdf",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  }
  const rel = `/uploads/run-setup-pdfs/${runId}.pdf`;
  const dir = path.join(LOCAL_UPLOAD_ROOT, "run-setup-pdfs");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${runId}.pdf`), pdfBytes);
  return rel;
}

export function absolutePathForStoragePath(storagePath: string): string {
  if (isRemoteStorageRef(storagePath)) {
    throw new Error("absolutePathForStoragePath does not support remote URLs");
  }
  const cleaned = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  if (!cleaned.startsWith("uploads/")) {
    throw new Error(`Unsupported local storagePath (expected /uploads/...): ${storagePath}`);
  }
  return path.join(LOCAL_UPLOAD_ROOT, cleaned.slice("uploads/".length));
}

export async function readBytesFromStorageRef(ref: string): Promise<Buffer> {
  const trimmed = ref.trim();
  if (isRemoteStorageRef(trimmed)) {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error(`Remote storage fetch failed: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(absolutePathForStoragePath(trimmed));
}

export async function storageRefIsReadable(ref: string): Promise<boolean> {
  try {
    await readBytesFromStorageRef(ref);
    return true;
  } catch {
    return false;
  }
}

export async function loadSetupDocumentFileFromStorage(input: {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}): Promise<File> {
  const bytes = await readBytesFromStorageRef(input.storagePath);
  return new File([new Uint8Array(bytes)], input.originalFilename || "upload", {
    type: input.mimeType || "application/octet-stream",
  });
}
