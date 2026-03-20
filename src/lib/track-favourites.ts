/**
 * Track favourites – single source of truth for schema.prisma model FavouriteTrack.
 * All favourite reads/writes go through this module. Do not call prisma.favouriteTrack elsewhere.
 *
 * Schema (prisma/schema.prisma):
 *   model FavouriteTrack { userId, trackId, createdAt; @@id([userId, trackId]) }
 *   Prisma delegate: prisma.favouriteTrack
 *
 * If the generated client does not include favouriteTrack (e.g. stale after schema change),
 * run: npx prisma generate
 */

import { prisma } from "@/lib/prisma";

function logDev(message: string, err?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.warn(`[track-favourites] ${message}`, err ?? "");
  }
}

/** Guard: avoid calling methods on undefined delegate (prevents "Cannot read properties of undefined (reading 'findFirst')"). */
function getDelegate(): typeof prisma.favouriteTrack | undefined {
  try {
    const delegate = (prisma as { favouriteTrack?: typeof prisma.favouriteTrack }).favouriteTrack;
    return delegate;
  } catch {
    return undefined;
  }
}

/**
 * Returns favourite track ids for a user. Safe: returns [] if delegate missing or query fails.
 */
export async function getFavouriteTrackIdsForUser(userId: string): Promise<string[]> {
  const delegate = getDelegate();
  if (!delegate) {
    logDev("prisma.favouriteTrack not available; run npx prisma generate");
    return [];
  }
  try {
    const rows = await delegate.findMany({
      where: { userId },
      select: { trackId: true },
    });
    return rows.map((r) => r.trackId);
  } catch (err) {
    logDev("getFavouriteTrackIdsForUser failed", err);
    return [];
  }
}

/**
 * Returns whether the track is favourited by the user. Safe: returns false on error.
 */
export async function isTrackFavourite(userId: string, trackId: string): Promise<boolean> {
  const delegate = getDelegate();
  if (!delegate) {
    logDev("prisma.favouriteTrack not available; run npx prisma generate");
    return false;
  }
  try {
    const row = await delegate.findFirst({
      where: { userId, trackId },
      select: { trackId: true },
    });
    return !!row;
  } catch (err) {
    logDev("isTrackFavourite failed", err);
    return false;
  }
}

export type ToggleResult = { ok: true; added: boolean } | { error: string };

/**
 * Toggle favourite: remove if present, add if not. Revalidation is caller's responsibility.
 */
export async function toggleTrackFavourite(userId: string, trackId: string): Promise<ToggleResult> {
  const delegate = getDelegate();
  if (!delegate) {
    const msg = "Favourites not available. Run: npx prisma generate";
    logDev(msg);
    return { error: msg };
  }
  try {
    const existing = await delegate.findFirst({
      where: { userId, trackId },
      select: { userId: true, trackId: true },
    });
    if (existing) {
      await delegate.deleteMany({ where: { userId, trackId } });
      return { ok: true, added: false };
    }
    await delegate.create({ data: { userId, trackId } });
    return { ok: true, added: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logDev("toggleTrackFavourite failed", err);
    return { error: msg };
  }
}

/**
 * Add track to user's favourites (e.g. when creating a track with addToFavourites).
 * No-op on error so track creation still succeeds.
 */
export async function addTrackToFavourites(userId: string, trackId: string): Promise<void> {
  const delegate = getDelegate();
  if (!delegate) {
    logDev("prisma.favouriteTrack not available; run npx prisma generate");
    return;
  }
  try {
    await delegate.create({ data: { userId, trackId } });
  } catch (err) {
    logDev("addTrackToFavourites failed", err);
  }
}

/**
 * Remove track from user's favourites. No-op on error.
 */
export async function removeTrackFavourite(userId: string, trackId: string): Promise<{ ok: boolean; error?: string }> {
  const delegate = getDelegate();
  if (!delegate) {
    logDev("prisma.favouriteTrack not available; run npx prisma generate");
    return { ok: false, error: "Favourites not available. Run: npx prisma generate" };
  }
  try {
    await delegate.deleteMany({ where: { userId, trackId } });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logDev("removeTrackFavourite failed", err);
    return { ok: false, error: msg };
  }
}
