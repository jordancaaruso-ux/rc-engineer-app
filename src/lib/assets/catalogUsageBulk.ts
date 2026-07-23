import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Bulk "is this row referenced by anyone at all" checks for the review queue — one groupBy per
 * relation over the shown ids (not per row), so gating the Delete button on a page of 50 rows
 * stays a handful of queries. A row is deletable only when NO set/run/event/etc. points at it;
 * anything in use must be merged, never deleted (delete would orphan or cascade real history).
 */

function collect(rows: Array<Record<string, string | null>>, key: string): string[] {
  return rows.map((r) => r[key]).filter((v): v is string => v != null);
}

export async function tireTypeIdsInUse(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [sets, parts] = await Promise.all([
    prisma.tireSet.groupBy({ by: ["tireTypeId"], where: { tireTypeId: { in: ids } } }),
    prisma.eventParticipation.groupBy({
      by: ["controlledTireTypeId"],
      where: { controlledTireTypeId: { in: ids } },
    }),
  ]);
  return new Set([...collect(sets, "tireTypeId"), ...collect(parts, "controlledTireTypeId")]);
}

export async function additiveTypeIdsInUse(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [runs, parts] = await Promise.all([
    prisma.run.groupBy({ by: ["additiveTypeId"], where: { additiveTypeId: { in: ids } } }),
    prisma.eventParticipation.groupBy({
      by: ["controlledAdditiveTypeId"],
      where: { controlledAdditiveTypeId: { in: ids } },
    }),
  ]);
  return new Set([...collect(runs, "additiveTypeId"), ...collect(parts, "controlledAdditiveTypeId")]);
}

export async function trackIdsInUse(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [runs, events, layouts, cameras, videos, jobs] = await Promise.all([
    prisma.run.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
    prisma.event.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
    prisma.trackLayout.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
    prisma.trackCameraProfile.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
    prisma.videoAsset.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
    prisma.videoAnalysisJob.groupBy({ by: ["trackId"], where: { trackId: { in: ids } } }),
  ]);
  return new Set([
    ...collect(runs, "trackId"),
    ...collect(events, "trackId"),
    ...collect(layouts, "trackId"),
    ...collect(cameras, "trackId"),
    ...collect(videos, "trackId"),
    ...collect(jobs, "trackId"),
  ]);
}
