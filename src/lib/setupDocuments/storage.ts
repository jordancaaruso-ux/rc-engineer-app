import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";

export const SETUP_DOC_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "setup-documents");

/** When set, setup PDFs and cached run-rendered PDFs use Vercel Blob; otherwise `public/uploads` (local dev). */
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

  await mkdir(SETUP_DOC_UPLOAD_DIR, { recursive: true });
  const absolutePath = path.join(SETUP_DOC_UPLOAD_DIR, filename);
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
  const dir = path.join(process.cwd(), "public", "uploads", "run-setup-pdfs");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(process.cwd(), "public", rel.replace(/^\/+/, "")), pdfBytes);
  return rel;
}

export function absolutePathForStoragePath(storagePath: string): string {
  if (isRemoteStorageRef(storagePath)) {
    throw new Error("absolutePathForStoragePath does not support remote URLs");
  }
  const cleaned = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  return path.join(process.cwd(), "public", cleaned);
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
