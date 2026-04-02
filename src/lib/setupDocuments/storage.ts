import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";

/**
 * Local disk fallback (development only — no `BLOB_READ_WRITE_TOKEN`).
 * Intentionally outside `public/` so Next/Vercel output file tracing does not bundle
 * uploaded PDFs into serverless functions (see `public/uploads` in repo).
 * DB values stay `/uploads/...`; resolve via `readLocalUploadBytes` (`.local-uploads` first, then legacy `public/`).
 */
const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), ".local-uploads");

/** Thrown when Vercel is running without Blob — local paths are not durable across invocations. */
export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

function isVercelDeployment(): boolean {
  return process.env.VERCEL === "1";
}

/** On Vercel, never persist to local disk — it breaks on the next lambda instance. */
function assertDurableStorageForWrites(): void {
  if (isVercelDeployment() && !useBlobStorage()) {
    throw new StorageConfigurationError(
      "BLOB_READ_WRITE_TOKEN is required on Vercel. Add it under Project → Settings → Environment Variables (Production / Preview). Local disk storage is not supported in serverless."
    );
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** When set, setup PDFs and cached run-rendered PDFs use Vercel Blob; otherwise `.local-uploads` (local dev). */
export function useBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function isRemoteStorageRef(ref: string): boolean {
  return /^https?:\/\//i.test(ref.trim());
}

function isLikelyVercelBlobHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

async function readableStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function sourceTypeFromMime(mimeType: string): "PDF" | "IMAGE" {
  return mimeType === "application/pdf" ? "PDF" : "IMAGE";
}

export async function storeSetupDocumentFile(file: File): Promise<{ storagePath: string }> {
  assertDurableStorageForWrites();
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : "";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const contentType = file.type?.trim() || "application/octet-stream";

  if (useBlobStorage()) {
    // Pass `File` through to `put` so we do not materialize a second full copy via `arrayBuffer()`
    // before streaming to the Blob API (reduces memory and often wall time vs buffer-then-put).
    const t0 = performance.now();
    const blob = await put(`setup-documents/${filename}`, file, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (process.env.DEBUG_SETUP_UPLOAD_TIMING === "1") {
      console.log(
        `[setup-upload-timing] blob put ${(performance.now() - t0).toFixed(1)}ms bytes=${file.size} pathname=setup-documents/${filename}`
      );
    }
    return { storagePath: blob.url };
  }

  const tBuf = performance.now();
  const bytes = Buffer.from(await file.arrayBuffer());
  if (process.env.DEBUG_SETUP_UPLOAD_TIMING === "1") {
    console.log(`[setup-upload-timing] local arrayBuffer ${(performance.now() - tBuf).toFixed(1)}ms bytes=${bytes.length}`);
  }
  const dir = path.join(LOCAL_UPLOAD_ROOT, "setup-documents");
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);
  const relativePath = `/uploads/setup-documents/${filename}`;
  const tWr = performance.now();
  await writeFile(absolutePath, bytes);
  if (process.env.DEBUG_SETUP_UPLOAD_TIMING === "1") {
    console.log(`[setup-upload-timing] local writeFile ${(performance.now() - tWr).toFixed(1)}ms`);
  }
  return { storagePath: relativePath };
}

/** Persist lazily rendered run setup PDF; returns DB value for `Run.renderedSetupPdfPath` (URL or `/uploads/...`). */
export async function storeRunRenderedSetupPdf(runId: string, pdfBytes: Buffer): Promise<string> {
  assertDurableStorageForWrites();
  const key = `run-setup-pdfs/${runId}.pdf`;
  if (useBlobStorage()) {
    const blob = await put(key, pdfBytes, {
      access: "private",
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

/**
 * Read bytes for a DB local ref (`/uploads/...`). Prefer `.local-uploads`, then legacy `public/` (local dev only).
 * Does not hit Blob — use `readBytesFromStorageRef` for full resolution.
 */
async function readLocalUploadBytes(storagePath: string): Promise<Buffer> {
  if (isRemoteStorageRef(storagePath)) {
    throw new Error("readLocalUploadBytes expected a local /uploads/ path");
  }
  const cleaned = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  if (!cleaned.startsWith("uploads/")) {
    throw new Error(`Unsupported local storagePath (expected /uploads/...): ${storagePath}`);
  }
  const relativeFromUploads = cleaned.slice("uploads/".length);
  const primary = path.join(LOCAL_UPLOAD_ROOT, relativeFromUploads);
  try {
    return await readFile(primary);
  } catch (e) {
    if (!isEnoent(e)) throw e;
  }
  try {
    const legacyPublic = path.join(process.cwd(), "public", cleaned);
    return await readFile(legacyPublic);
  } catch (e2) {
    if (!isEnoent(e2)) throw e2;
    const hint = isVercelDeployment()
      ? " On Vercel, re-upload the setup sheet with BLOB_READ_WRITE_TOKEN configured so the file is stored on Blob (legacy /uploads/... rows are not available after serverless deploy)."
      : " For local dev, place the file under .local-uploads/ or public/uploads/ matching the /uploads/... path, or set BLOB_READ_WRITE_TOKEN.";
    throw new Error(`Stored file not found for local path ${storagePath}.${hint}`);
  }
}

export async function readBytesFromStorageRef(ref: string): Promise<Buffer> {
  const trimmed = ref.trim();
  if (isRemoteStorageRef(trimmed)) {
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (token && isLikelyVercelBlobHttpUrl(trimmed)) {
      const result = await get(trimmed, {
        access: "private",
        token,
        useCache: false,
      });
      if (result?.statusCode === 200 && result.stream) {
        return readableStreamToBuffer(result.stream);
      }
    }
    const res = await fetch(trimmed, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Remote storage fetch failed: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return readLocalUploadBytes(trimmed);
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
