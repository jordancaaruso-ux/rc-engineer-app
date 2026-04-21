import { prisma } from "@/lib/prisma";

type BodyLike = {
  importedLapSets?: Array<{ isPrimaryUser?: boolean; sessionCompletedAt?: string | null }>;
  importedLapTimeSessionIds?: string[];
};

/** Best-effort session wall time from request body (before or after Run row exists). */
export async function resolveRunSessionCompletedAtFromUpsertBody(
  userId: string,
  body: BodyLike
): Promise<Date | null> {
  const sets = body.importedLapSets ?? [];
  const primary = sets.find((s) => s.isPrimaryUser) ?? sets[0];
  if (primary && typeof primary.sessionCompletedAt === "string" && primary.sessionCompletedAt.trim()) {
    const d = new Date(primary.sessionCompletedAt.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  const ids = (body.importedLapTimeSessionIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0
  );
  if (ids.length === 0) return null;
  const row = await prisma.importedLapTimeSession.findFirst({
    where: { userId, id: ids[0] },
    select: { sessionCompletedAt: true },
  });
  return row?.sessionCompletedAt ?? null;
}
