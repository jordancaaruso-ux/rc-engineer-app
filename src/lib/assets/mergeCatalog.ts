import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Admin merge for global catalog identities: repoint every row that references the loser onto
 * the winner, then delete the loser. This is how a duplicate (two "Ronny's RC" tracks, two
 * "Sweep D32" tire types) is collapsed without losing the history that accreted onto the dup —
 * the fragmentation-recovery escape hatch from docs/ASSET_ACCESS_NORTH_STAR.md. Also the engine
 * the dedupe-* scripts call for bulk collapse.
 *
 * Every write runs in one transaction so a partial repoint can never orphan a row.
 */

/** TireType is referenced by Run.tireTypeId, TireSet.tireTypeId (dormant) and EventParticipation.controlledTireTypeId. */
export async function mergeTireTypes(input: {
  winnerId: string;
  loserId: string;
}): Promise<void> {
  const { winnerId, loserId } = input;
  if (winnerId === loserId) return;

  await prisma.$transaction(async (tx) => {
    await tx.run.updateMany({
      where: { tireTypeId: loserId },
      data: { tireTypeId: winnerId },
    });
    await tx.tireSet.updateMany({
      where: { tireTypeId: loserId },
      data: { tireTypeId: winnerId },
    });
    await tx.eventParticipation.updateMany({
      where: { controlledTireTypeId: loserId },
      data: { controlledTireTypeId: winnerId },
    });
    await tx.tireType.delete({ where: { id: loserId } });
  });
}

/**
 * Track has many dependents. Plain FK columns just repoint; the two composite-PK join rows
 * (FavouriteTrack, TrackLocationRunPromptDismissal, both keyed on (userId, trackId)) would
 * collide if a user touched both tracks, so we create-if-missing then drop the loser's rows.
 */
export async function mergeTracks(input: {
  winnerId: string;
  loserId: string;
}): Promise<void> {
  const { winnerId, loserId } = input;
  if (winnerId === loserId) return;

  await prisma.$transaction(async (tx) => {
    // Plain FK repoints (mix of Cascade + SetNull relations — all just move to the winner).
    await tx.run.updateMany({ where: { trackId: loserId }, data: { trackId: winnerId } });
    await tx.event.updateMany({ where: { trackId: loserId }, data: { trackId: winnerId } });
    await tx.trackLayout.updateMany({ where: { trackId: loserId }, data: { trackId: winnerId } });
    await tx.trackCameraProfile.updateMany({
      where: { trackId: loserId },
      data: { trackId: winnerId },
    });
    await tx.videoAsset.updateMany({ where: { trackId: loserId }, data: { trackId: winnerId } });
    await tx.videoAnalysisJob.updateMany({
      where: { trackId: loserId },
      data: { trackId: winnerId },
    });

    // Composite-PK (userId, trackId) rows: create winner-side where absent, then drop loser's.
    const loserFavs = await tx.favouriteTrack.findMany({
      where: { trackId: loserId },
      select: { userId: true },
    });
    if (loserFavs.length > 0) {
      await tx.favouriteTrack.createMany({
        data: loserFavs.map((f) => ({ userId: f.userId, trackId: winnerId })),
        skipDuplicates: true,
      });
      await tx.favouriteTrack.deleteMany({ where: { trackId: loserId } });
    }

    const loserDismissals = await tx.trackLocationRunPromptDismissal.findMany({
      where: { trackId: loserId },
      select: { userId: true },
    });
    if (loserDismissals.length > 0) {
      await tx.trackLocationRunPromptDismissal.createMany({
        data: loserDismissals.map((d) => ({ userId: d.userId, trackId: winnerId })),
        skipDuplicates: true,
      });
      await tx.trackLocationRunPromptDismissal.deleteMany({ where: { trackId: loserId } });
    }

    // Backfill durable facts the winner is missing from the loser (don't clobber existing).
    const [winner, loser] = await Promise.all([
      tx.track.findUnique({
        where: { id: winnerId },
        select: {
          location: true,
          latitude: true,
          longitude: true,
          liveRcUrl: true,
          speedhiveUrl: true,
        },
      }),
      tx.track.findUnique({
        where: { id: loserId },
        select: {
          location: true,
          latitude: true,
          longitude: true,
          locationMarkedAt: true,
          locationSource: true,
          liveRcUrl: true,
          speedhiveUrl: true,
        },
      }),
    ]);
    if (winner && loser) {
      const fill: {
        location?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        locationMarkedAt?: Date | null;
        locationSource?: string | null;
        liveRcUrl?: string | null;
        speedhiveUrl?: string | null;
      } = {};
      if (!winner.location && loser.location) fill.location = loser.location;
      if (winner.latitude == null && loser.latitude != null) {
        fill.latitude = loser.latitude;
        fill.longitude = loser.longitude;
        fill.locationMarkedAt = loser.locationMarkedAt;
        fill.locationSource = loser.locationSource;
      }
      if (!winner.liveRcUrl && loser.liveRcUrl) fill.liveRcUrl = loser.liveRcUrl;
      if (!winner.speedhiveUrl && loser.speedhiveUrl) fill.speedhiveUrl = loser.speedhiveUrl;
      if (Object.keys(fill).length > 0) {
        await tx.track.update({ where: { id: winnerId }, data: fill });
      }
    }

    await tx.track.delete({ where: { id: loserId } });
  });
}
