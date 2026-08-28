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

/** Vercel serverless body limit (~4.5 MB). */
export const VIDEO_MAX_BYTES_VERCEL = 4 * 1024 * 1024;
/** Local dev / self-hosted: allow full 1080p60 heat uploads. */
export const VIDEO_MAX_BYTES_LOCAL = 512 * 1024 * 1024;
/**
 * Client-direct blob uploads never pass through a serverless body, so the cap is our own.
 * Just under 2GB — `VideoAsset.bytes` is a 4-byte Int, and 2GiB exactly would overflow it.
 */
export const VIDEO_MAX_BYTES_DIRECT = 2000 * 1024 * 1024;

export function videoMaxUploadBytes(): number {
  if (process.env.VERCEL === "1") return VIDEO_MAX_BYTES_VERCEL;
  return VIDEO_MAX_BYTES_LOCAL;
}

/** @deprecated Use videoMaxUploadBytes() */
export const VIDEO_MAX_BYTES = VIDEO_MAX_BYTES_VERCEL;

export const VIDEO_ALLOWED_MIME = new Set<string>(["video/mp4", "video/webm", "video/quicktime"]);

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function storeVideoFile(
  file: File,
  opts?: { maxBytes?: number }
): Promise<{ storagePath: string }> {
  const maxBytes = opts?.maxBytes ?? videoMaxUploadBytes();
  if (file.size > maxBytes) {
    throw new Error(
      `Video exceeds max size (${(maxBytes / (1024 * 1024)).toFixed(0)} MB)`
    );
  }
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

/** Store id embedded in the read-write token (`vercel_blob_rw_<ID>_…`); hostnames use it lowercased. */
export function videoBlobStoreId(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
  return m ? m[1].toLowerCase() : null;
}

/**
 * True only for URLs inside OUR blob store. The register endpoint trusts a client-supplied
 * URL as far as calling `head()` on it — this check keeps that from becoming a way to attach
 * someone else's (or some other store's) file to a VideoAsset row.
 */
export function isOwnVideoBlobUrl(raw: string): boolean {
  const storeId = videoBlobStoreId();
  if (!storeId) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (u.hostname === `${storeId}.private.blob.vercel-storage.com` ||
        u.hostname === `${storeId}.public.blob.vercel-storage.com`)
    );
  } catch {
    return false;
  }
}

/** Decoded pathname inside the store for one of our blob URLs (e.g. `videos/<uuid>.mp4`). */
export function blobPathnameFromUrl(raw: string): string {
  return decodeURIComponent(new URL(raw).pathname.replace(/^\//, ""));
}

