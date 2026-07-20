import { prisma } from "@/lib/prisma";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import {
  isWallClockAsUtcTimingSource,
  timingSourceFromSourceUrl,
} from "@/lib/lapImport/labels";

type BodyLike = {
  importedLapSets?: Array<{
    isPrimaryUser?: boolean;
    sessionCompletedAt?: string | null;
    sourceUrl?: string | null;
    /**
     * True when `sessionCompletedAt` is an on-track wall time from the timing
     * page (vs the import row's `createdAt` fallback, which is a real instant).
     * Sent by NewRunForm; conversion below only trusts an explicit `true`.
     */
    sessionCompletedAtIsWallClock?: boolean;
  }>;
  importedLapTimeSessionIds?: string[];
};

/**
 * LiveRC/MyRCM session times are track wall clock stored as-if-UTC (see
 * `lapImport/labels.ts`). `Run.sessionCompletedAt` feeds real-instant consumers
 * — run-row display in the viewer's zone, and the weather conditions backfill —
 * so before storing we reinterpret the wall clock in the user's timezone (the
 * track is virtually always in the driver's own zone). Speedhive times are
 * already real instants and pass through untouched, as does everything when the
 * timezone cookie is missing. Per-set `RunImportedLapSet.sessionCompletedAt`
 * deliberately stays wall-clock-as-UTC — its display sites freeze it in UTC.
 */
function toRealInstant(
  d: Date,
  sourceUrl: string | null | undefined,
  userTimeZone: string | null | undefined
): Date {
  const tz = userTimeZone?.trim();
  if (!tz) return d;
  if (!isWallClockAsUtcTimingSource(timingSourceFromSourceUrl(sourceUrl))) return d;
  return wallClockAsUtcToInstant(d, tz);
}

/** Best-effort session time from request body (before or after Run row exists). */
export async function resolveRunSessionCompletedAtFromUpsertBody(
  userId: string,
  body: BodyLike,
  opts?: { userTimeZone?: string | null }
): Promise<Date | null> {
  const sets = body.importedLapSets ?? [];
  const primary = sets.find((s) => s.isPrimaryUser) ?? sets[0];
  if (primary && typeof primary.sessionCompletedAt === "string" && primary.sessionCompletedAt.trim()) {
    const d = new Date(primary.sessionCompletedAt.trim());
    if (!Number.isNaN(d.getTime())) {
      // The client's value may be the import createdAt fallback (a real
      // instant), so convert only when it explicitly says wall clock.
      return primary.sessionCompletedAtIsWallClock === true
        ? toRealInstant(d, primary.sourceUrl, opts?.userTimeZone)
        : d;
    }
  }
  const ids = (body.importedLapTimeSessionIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0
  );
  if (ids.length === 0) return null;
  const row = await prisma.importedLapTimeSession.findFirst({
    where: { userId, id: ids[0] },
    select: { sessionCompletedAt: true, sourceUrl: true },
  });
  // `ImportedLapTimeSession.sessionCompletedAt` is parse-derived only (never a
  // createdAt fallback), so source alone decides conversion here.
  return row?.sessionCompletedAt
    ? toRealInstant(row.sessionCompletedAt, row.sourceUrl, opts?.userTimeZone)
    : null;
}
