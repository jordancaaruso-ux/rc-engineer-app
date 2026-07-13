import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

/**
 * Profile pictures are stored **private**, like every other blob class — the Blob store
 * this project uses is a private store and rejects `access: "public"`. The avatar renders
 * in a client `<img src>` (`AccountMenu`, settings), so we stream it back through the
 * authenticated self-proxy at `GET /api/profile-image` (the src is rewritten by
 * `avatarSrc`). Every upload is normalized to a small square, metadata-stripped WebP first
 * — consistent sizing plus EXIF (incl. GPS) removal.
 *
 * Local dev (no `BLOB_READ_WRITE_TOKEN`) falls back to `public/uploads/avatars/` so the
 * `/uploads/avatars/...` path is served statically by Next.
 */

const LOCAL_PUBLIC_ROOT = path.join(process.cwd(), "public", "uploads", "avatars");

export const PROFILE_IMAGE_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
/** Guard on the *received* bytes; the client downscales first, so this only catches abuse. */
export const PROFILE_IMAGE_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const AVATAR_SIZE = 256;

export class ProfileImageStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileImageStorageError";
  }
}

function hasBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function isVercelDeployment(): boolean {
  return process.env.VERCEL === "1";
}

/** Normalize to a square, metadata-stripped WebP and persist to a directly-loadable URL. */
export async function storeProfileImage(bytes: Buffer): Promise<{ url: string }> {
  let processed: Buffer;
  try {
    processed = await sharp(bytes)
      // Honor EXIF orientation before we strip metadata (sharp drops metadata by default).
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ProfileImageStorageError("That image could not be read. Try a PNG, JPEG, or WebP.");
  }

  const filename = `${randomUUID()}.webp`;

  if (hasBlobStorage()) {
    const blob = await put(`avatars/${filename}`, processed, {
      access: "private",
      contentType: "image/webp",
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url };
  }

  if (isVercelDeployment()) {
    throw new ProfileImageStorageError(
      "BLOB_READ_WRITE_TOKEN is required on Vercel to store profile pictures."
    );
  }

  await mkdir(LOCAL_PUBLIC_ROOT, { recursive: true });
  await writeFile(path.join(LOCAL_PUBLIC_ROOT, filename), processed);
  return { url: `/uploads/avatars/${filename}` };
}

/** Read a stored avatar's bytes for the authed self-proxy (private blob or local `/uploads` ref). */
export async function readProfileImageBytes(ref: string): Promise<Buffer> {
  return readBytesFromStorageRef(ref);
}

/** Best-effort cleanup of a previously stored avatar (remote blobs only; dev files are disposable). */
export async function deleteProfileImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    if (/^https?:\/\//i.test(url) && hasBlobStorage()) {
      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    }
  } catch {
    // best-effort — a dangling blob is not worth failing the request over
  }
}
