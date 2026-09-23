import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { importedSessionFieldStatsPreviewFromJson } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import { loadSessionTrackNames } from "@/lib/lapImport/loadSessionNames";

/**
 * The newest imports with their laps, for the lap-sheet pickers (`useImportedLapLibrary`). The
 * Laptime Analysis list reads `/api/lap-time-sessions/library` instead: every session, named.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  /*
   * Newest import first, and the cap is a cap on THOSE. `take: 200` with no `orderBy` let
   * Postgres hand back whichever 200 it liked — for an account with 648 imports that was a
   * block from April, and every session uploaded since was invisible on the library page
   * (2026-08-27: "I've imported a bunch of MyRCM sessions, but they're not in the list").
   * `total` rides along so the page can say the list is cut, rather than looking complete.
   */
  // Deleted sessions (`hiddenAt`) leave every lap-sheet picker fed from here.
  const [rows, total] = await Promise.all([
    prisma.importedLapTimeSession.findMany({
    where: { userId: userId, hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      sessionCompletedAt: true,
      sourceUrl: true,
      parserId: true,
      sourceType: true,
      linkedRunId: true,
      linkedEventId: true,
      parsedPayload: true,
      fieldStatsJson: true,
      // What the session was CALLED. Without these the library list had to fall back to
      // naming each row after a driver off the sheet, which on a race is an arbitrary
      // entrant — see `importedSessionTitle`.
      eventDetectionSource: true,
      eventDetectionSessionLabel: true,
      eventRaceClass: true,
      // Where it was: the sweep's track, a linked run's or event's, or (below) the club whose
      // timing address matches. The lap sheet only compares within one track, so a session
      // with no track of ours never reaches a picker.
      track: { select: { name: true } },
      linkedRun: {
        select: { trackNameSnapshot: true, track: { select: { name: true } } },
      },
      linkedEvent: { select: { track: { select: { name: true } } } },
    },
    }),
    prisma.importedLapTimeSession.count({ where: { userId, hiddenAt: null } }),
  ]);
  const tracks = await loadSessionTrackNames(userId, rows);

  const sessions = rows
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      sessionCompletedAt: r.sessionCompletedAt ? r.sessionCompletedAt.toISOString() : null,
      sourceUrl: r.sourceUrl,
      parserId: r.parserId,
      sourceType: r.sourceType,
      linkedRunId: r.linkedRunId,
      linkedEventId: r.linkedEventId,
      eventDetectionSource: r.eventDetectionSource,
      eventDetectionSessionLabel: r.eventDetectionSessionLabel,
      eventRaceClass: r.eventRaceClass,
      trackName: tracks.get(r.id) ?? null,
      parsedPayload: r.parsedPayload,
      fieldStatsPreview: importedSessionFieldStatsPreviewFromJson(r.fieldStatsJson),
    }))
    /*
     * Most recently UPLOADED first — the pickers' "newest 200" — and within one upload (one
     * pasted LiveRC event page lands thirty races in the same second) the race clock decides.
     */
    .sort((a, b) => {
      const ua = new Date(a.createdAt).getTime();
      const ub = new Date(b.createdAt).getTime();
      if (Math.abs(ua - ub) > 60_000) return ub - ua;
      const ta = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: a.sessionCompletedAt,
        parsedPayload: a.parsedPayload,
        createdAt: a.createdAt,
      });
      const tb = resolveImportedSessionDisplayTimeIso({
        sessionCompletedAt: b.sessionCompletedAt,
        parsedPayload: b.parsedPayload,
        createdAt: b.createdAt,
      });
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

  return NextResponse.json({ sessions, total });
}
