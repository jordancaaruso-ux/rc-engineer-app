import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import { importedSessionFieldStatsPreviewFromJson } from "@/lib/lapImport/computeImportedSessionFieldStats";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";
import {
  loadSessionNames,
  loadSessionNamingViewer,
  loadSessionTrackNames,
  SESSION_NAMING_SELECT,
  type SessionTrackRow,
} from "@/lib/lapImport/loadSessionNames";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import { isViewerPrintedName } from "@/lib/lapImport/sessionNaming";
import { lapCompareTrackKey } from "@/lib/lapCompareScope";

/** The newest imports, when the sheet has no track to ask for. */
const NEWEST_MAX = 200;
/** A ceiling on the account read for one track, not a page size: far past any account today. */
const ACCOUNT_MAX = 2000;

const FEED_SELECT = {
  // What the session was CALLED, where it was and whose — see `loadSessionNames`.
  ...SESSION_NAMING_SELECT,
  sourceType: true,
  linkedEventId: true,
  fieldStatsJson: true,
  detectedPrimaryForRun: { select: { id: true } },
} as const;

/**
 * Every import at one track, on none of the viewer's runs — the only sessions a lap sheet at that
 * track can offer (founder call, 2026-09-24: comparisons stay at one track). Capped at the newest
 * 200 uploads, a race brought in months ago never reached the sheet whose track it ran at.
 *
 * The track is worked out the same way the library names it (`loadSessionTrackNames`), which
 * needs only a few columns and the payload's hint — so the payloads, the heavy part, are read for
 * this track's sessions alone.
 */
async function sessionIdsAtTrack(userId: string, trackKey: string): Promise<string[]> {
  const [light, hints] = await Promise.all([
    prisma.importedLapTimeSession.findMany({
      where: { userId, hiddenAt: null, linkedRunId: null, detectedPrimaryForRun: null },
      orderBy: { createdAt: "desc" },
      take: ACCOUNT_MAX,
      select: {
        id: true,
        sourceUrl: true,
        track: { select: { name: true } },
        linkedRun: { select: { trackNameSnapshot: true, track: { select: { name: true } } } },
        linkedEvent: { select: { track: { select: { name: true } } } },
      },
    }),
    prisma.$queryRaw<Array<{ id: string; hint: unknown }>>`
      SELECT "id", "parsedPayload"->'sessionHint' AS "hint"
      FROM "ImportedLapTimeSession"
      WHERE "userId" = ${userId} AND "hiddenAt" IS NULL AND "linkedRunId" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT ${ACCOUNT_MAX}
    `,
  ]);
  const hintById = new Map(hints.map((h) => [h.id, h.hint]));
  const rows: SessionTrackRow[] = light.map((r) => ({
    ...r,
    parsedPayload: { sessionHint: hintById.get(r.id) ?? null },
  }));
  const tracks = await loadSessionTrackNames(userId, rows);
  return rows.filter((r) => lapCompareTrackKey(tracks.get(r.id)) === trackKey).map((r) => r.id);
}

/**
 * Imports with their laps, for the lap-sheet pickers (`useImportedLapLibrary`). The Laptime
 * Analysis list reads `/api/lap-time-sessions/library` instead: every session, named.
 *
 *   ?track=<name> — every import at that track that is on none of the viewer's runs. What a lap
 *                   sheet asks for: it compares within its own track, and a session on a run is
 *                   that run's laps, already on the sheet.
 *   (no track)    — the newest 200 imports, for a sheet with no track of its own.
 *
 * Each row says what the pickers need to file it (founder call, 2026-09-24): whether it is on one
 * of the viewer's runs, whether it is the viewer's own, which driver on a race sheet is the
 * viewer, and the session's name.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const trackKey = lapCompareTrackKey(new URL(request.url).searchParams.get("track"));

  /*
   * Newest import first, and the cap is a cap on THOSE. `take: 200` with no `orderBy` let
   * Postgres hand back whichever 200 it liked — for an account with 648 imports that was a
   * block from April, and every session uploaded since was invisible on the library page
   * (2026-08-27: "I've imported a bunch of MyRCM sessions, but they're not in the list").
   * `total` rides along so the page can say the list is cut, rather than looking complete.
   */
  // Deleted sessions (`hiddenAt`) leave every lap-sheet picker fed from here.
  const [rows, total, viewer, viewerUser] = await Promise.all([
    trackKey
      ? sessionIdsAtTrack(userId, trackKey).then((ids) =>
          ids.length === 0
            ? []
            : prisma.importedLapTimeSession.findMany({
                where: { userId, id: { in: ids } },
                orderBy: { createdAt: "desc" },
                select: FEED_SELECT,
              })
        )
      : prisma.importedLapTimeSession.findMany({
          where: { userId: userId, hiddenAt: null },
          orderBy: { createdAt: "desc" },
          take: NEWEST_MAX,
          select: FEED_SELECT,
        }),
    prisma.importedLapTimeSession.count({ where: { userId, hiddenAt: null } }),
    loadSessionNamingViewer(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
  ]);
  /*
   * Named the way the library and the session page name them, which also settles the track: the
   * lap sheet only compares within one track, so a session with no track of ours never reaches
   * a picker.
   */
  const names = await loadSessionNames({
    userId,
    rows,
    timeZone: viewerUser?.timeZone?.trim() || null,
    viewer,
  });

  const sessions = rows
    .map((r) => {
      const name = names.get(r.id) ?? null;
      const onRunId = r.linkedRunId ?? r.detectedPrimaryForRun?.id ?? null;
      // The viewer's own row on a race sheet, by the same "is this you" the session's name uses.
      const viewerDriverId = name?.isRace
        ? ((rawSessionDriversFromImportedPayload(r.parsedPayload) ?? []).find((d) =>
            isViewerPrintedName(d.driverName, viewer.names)
          )?.id ?? null)
        : null;
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        sessionCompletedAt: r.sessionCompletedAt ? r.sessionCompletedAt.toISOString() : null,
        sourceUrl: r.sourceUrl,
        parserId: r.parserId,
        sourceType: r.sourceType,
        linkedRunId: r.linkedRunId,
        linkedEventId: r.linkedEventId,
        onRunId,
        mine: onRunId != null || (name?.isViewer ?? false),
        viewerDriverId,
        label: name?.label ?? null,
        eventDetectionSource: r.eventDetectionSource,
        eventDetectionSessionLabel: r.eventDetectionSessionLabel,
        eventRaceClass: r.eventRaceClass,
        trackName: name?.trackName ?? null,
        parsedPayload: r.parsedPayload,
        fieldStatsPreview: importedSessionFieldStatsPreviewFromJson(r.fieldStatsJson),
      };
    })
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
