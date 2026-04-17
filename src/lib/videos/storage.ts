import "server-only";

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import {
  StorageConfigurationError,
  readBytesFromStorageRef,
} from "@/lib/setupDocuments/storage";

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), ".local-uploads");

export const VIDEO_MAX_BYTES = 4 * 1024 * 1024; // Vercel server upload limit is ~4.5MB
export const VIDEO_ALLOWED_MIME = new Set<string>(["video/mp4", "video/webm", "video/quicktime"]);

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function storeVideoFile(file: File): Promise<{ storagePath: string }> {
  const ext = path.extname(file.name || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 ? ext : "";
  const filename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${safeExt}`;
  const contentType = file.type?.trim() || "application/octet-stream";

  if (hasBlobToken()) {
    const blob = await put(`videos/${filename}`, file, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { storagePath: blob.url };
  }

  // Local-only fallback; not durable on Vercel deployments.
  if (process.env.VERCEL === "1") {
    throw new StorageConfigurationError(
      "BLOB_READ_WRITE_TOKEN is required on Vercel for video uploads. Local disk storage is not supported in serverless."
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(LOCAL_UPLOAD_ROOT, "videos");
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);
  const relativePath = `/uploads/videos/${filename}`;
  await writeFile(absolutePath, bytes);
  return { storagePath: relativePath };
}

export async function readVideoBytesFromStorageRef(ref: string): Promise<Buffer> {
  return readBytesFromStorageRef(ref);
}

