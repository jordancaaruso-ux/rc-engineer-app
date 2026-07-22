import "server-only";

import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

/**
 * Delete a user's uploaded files from Vercel Blob.
 *
 * `prisma.user.delete` only cascades DB rows — without this, setup sheets, videos and avatars
 * survive an account deletion, so we keep storing (and paying for) files someone explicitly asked
 * us to remove. The privacy policy promises they go.
 *
 * Local dev refs (`/uploads/...`) are left alone: they're disposable and there's no remote object.
 */

const REMOTE_URL = /^https?:\/\//i;

/** Collect every remote blob URL owned by the user. Call BEFORE the cascading delete. */
export async function collectUserBlobUrls(userId: string): Promise<string[]> {
  const [docs, videos, user] = await Promise.all([
    prisma.setupDocument.findMany({ where: { userId }, select: { storagePath: true } }),
    prisma.videoAsset.findMany({ where: { userId }, select: { storagePath: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { image: true } }),
  ]);

  const urls = [
    ...docs.map((d) => d.storagePath),
    ...videos.map((v) => v.storagePath),
    user?.image ?? null,
  ];

  return [...new Set(urls.filter((u): u is string => !!u && REMOTE_URL.test(u)))];
}

/**
 * Best-effort removal. Never throws: a blob that fails to delete must not strand the account in a
 * half-deleted state — the DB rows are the thing the user can see. Failures are logged so an
 * orphan can be cleaned up by hand.
 */
export async function deleteBlobUrls(urls: string[]): Promise<{ deleted: number; failed: number }> {
  if (urls.length === 0) return { deleted: 0, failed: 0 };
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[account-delete] BLOB_READ_WRITE_TOKEN unset — skipping blob cleanup");
    return { deleted: 0, failed: urls.length };
  }

  let deleted = 0;
  let failed = 0;
  // `del` takes a batch, but one bad URL fails the batch — chunk so a single stale ref can't
  // strand everything else.
  const CHUNK = 25;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    try {
      await del(chunk, { token });
      deleted += chunk.length;
    } catch (error) {
      failed += chunk.length;
      console.error(`[account-delete] blob delete failed for ${chunk.length} file(s)`, error);
    }
  }
  return { deleted, failed };
}
