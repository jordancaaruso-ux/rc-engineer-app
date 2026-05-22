import "server-only";

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { StorageConfigurationError } from "@/lib/setupDocuments/storage";

const LOCAL_ROOT = path.join(process.cwd(), ".local-uploads", "video-analysis");

function hasBlobStorageToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function assertDurableStorageForWrites(): void {
  if (process.env.VERCEL === "1" && !hasBlobStorageToken()) {
    throw new StorageConfigurationError(
      "BLOB_READ_WRITE_TOKEN is required on Vercel for reference image upload."
    );
  }
}

/** Store camera profile reference still — Blob on Vercel, local disk in dev. */
export async function storeVideoAnalysisReferenceFile(
  file: File
): Promise<{ storagePath: string }> {
  assertDurableStorageForWrites();
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : ".jpg";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const contentType = file.type?.trim() || "image/jpeg";

  if (hasBlobStorageToken()) {
    const blob = await put(`video-analysis/reference/${filename}`, file, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { storagePath: blob.url };
  }

  const dir = path.join(LOCAL_ROOT, "reference");
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), bytes);
  return { storagePath: `/uploads/video-analysis/reference/${filename}` };
}

/** Large local videos (dev only — not for Vercel serverless bodies). */
export async function storeVideoAnalysisLocalFile(
  file: File,
  subdir: "reference" | "videos"
): Promise<{ storagePath: string; absolutePath: string }> {
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : ".jpg";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const dir = path.join(LOCAL_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, bytes);
  const storagePath = `/uploads/video-analysis/${subdir}/${filename}`;
  return { storagePath, absolutePath };
}
