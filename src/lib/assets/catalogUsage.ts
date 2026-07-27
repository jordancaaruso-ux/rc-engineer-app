import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * "Used by others" checks for the unified catalog edit/delete rule. A row counts as used
 * by others once any user besides the creator has a run / set / participation / document
 * that references it. See docs/ASSET_ACCESS_NORTH_STAR.md.
 *
 * Callers should short-circuit and only invoke these when the requester is the unverified
 * row's creator (admins bypass; verified rows are admin-only regardless).
 */

export async function tireTypeUsedByOthers(
  tireTypeId: string,
  creatorUserId: string
): Promise<boolean> {
  const [setByOther, participationByOther] = await Promise.all([
    prisma.run.count({
      where: { tireTypeId, userId: { not: creatorUserId } },
    }),
    prisma.eventParticipation.count({
      where: { controlledTireTypeId: tireTypeId, userId: { not: creatorUserId } },
    }),
  ]);
  return setByOther > 0 || participationByOther > 0;
}

export async function additiveTypeUsedByOthers(
  additiveTypeId: string,
  creatorUserId: string
): Promise<boolean> {
  const [runByOther, participationByOther] = await Promise.all([
    prisma.run.count({
      where: { additiveTypeId, userId: { not: creatorUserId } },
    }),
    prisma.eventParticipation.count({
      where: { controlledAdditiveTypeId: additiveTypeId, userId: { not: creatorUserId } },
    }),
  ]);
  return runByOther > 0 || participationByOther > 0;
}

export async function trackUsedByOthers(
  trackId: string,
  creatorUserId: string
): Promise<boolean> {
  const [runByOther, eventByOther] = await Promise.all([
    prisma.run.count({
      where: { trackId, userId: { not: creatorUserId } },
    }),
    prisma.event.count({
      where: { trackId, userId: { not: creatorUserId } },
    }),
  ]);
  return runByOther > 0 || eventByOther > 0;
}
