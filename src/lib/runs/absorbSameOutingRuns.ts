import "server-only";

import { prisma } from "@/lib/prisma";
import {
  trackClockOutingFromImportedRow,
  type ImportedRowForOuting,
} from "@/lib/runs/outingsFromImportedSessions";
import type { Span } from "@/lib/runs/outingSpan";
import { planSameOutingAbsorption, runHasDriverWriting } from "@/lib/runs/sameOutingAbsorption";
import { isValidIanaTimeZone, timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";

/**
 * One run per time on track, whichever way round the day arrived (founder ruling 2026-09-15,
 * extended to the save 2026-09-17).
 *
 * The evening pass and "Add N other runs" never open a run over a window a run already covers.
 * The order can go the other way, though: the app files the day from Speedhive at 8 pm, and the
 * driver logs the same race the next morning from the MyRCM PDF. Saved as it was, that was two
 * runs for one race — the day's pace, the Debrief, the run count and the Engineer all saw it twice.
 *
 * So when a driver's run is saved with timing sessions, an app-made run (still unconfirmed) at the
 * same track covering the same time on track folds into it: its sessions ride along on the
 * driver's run as linked sources, the way the evening pass links a second site's copy, and it
 * goes. The driver's laps and primary session are never changed. A run the driver confirmed is
 * never touched, and neither is an unconfirmed one they have written on.
 *
 * The existing dissolve in `linkImportedSessionsToRun` covers the same session being claimed; this
 * covers the same race arriving from another site.
 *
 * Races are compared on the track's own clock, which every timing site posts (`trackClock.ts`):
 * a driver saving from home after flying back from the meeting folds the same runs as one saving
 * in the pits.
 */

const SESSION_SELECT = {
  id: true,
  sourceUrl: true,
  parserId: true,
  parsedPayload: true,
  sessionCompletedAt: true,
} as const;

/**
 * Slack either side of the run's time on track when looking for runs filed over it. The spans are
 * on the track's clock and the columns searched are real instants, at most fourteen hours apart,
 * which this more than covers.
 */
const SEARCH_SLACK_MS = 36 * 60 * 60 * 1000;

/** On the track's clock; the zone only reads a practice import saved without the track's offset. */
function spansOf(rows: ReadonlyArray<ImportedRowForOuting | null>, fallbackTimeZone: string | null): Span[] {
  const seen = new Set<string>();
  const spans: Span[] = [];
  for (const row of rows) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    const session = trackClockOutingFromImportedRow(row, fallbackTimeZone);
    if (session) spans.push({ start: session.start, end: session.end });
  }
  return spans;
}

/** Returns the ids of the runs folded in. */
export async function absorbSameOutingRuns(params: { userId: string; runId: string }): Promise<string[]> {
  const run = await prisma.run.findFirst({
    where: { id: params.runId, userId: params.userId },
    select: {
      id: true,
      trackId: true,
      localTimeZone: true,
      unconfirmedAt: true,
      track: { select: { timeZone: true, latitude: true, longitude: true } },
      linkedImportedLapSessions: { select: SESSION_SELECT },
    },
  });
  // Only a run the driver vouched for takes others in. App-made runs are grouped by the evening
  // pass before they are filed; and with no track there is no "same place".
  if (!run || !run.trackId || run.unconfirmedAt) return [];
  // The track's zone reads an old practice import better than the zone the run was saved in.
  const trackZone = run.track?.timeZone;
  const fallbackZone =
    (isValidIanaTimeZone(trackZone) ? trackZone.trim() : null) ??
    timeZoneForCoordinates(run.track?.latitude, run.track?.longitude) ??
    run.localTimeZone;
  const runSpans = spansOf(run.linkedImportedLapSessions, fallbackZone);
  if (runSpans.length === 0) return [];

  const from = new Date(Math.min(...runSpans.map((s) => s.start.getTime())) - SEARCH_SLACK_MS);
  const to = new Date(Math.max(...runSpans.map((s) => s.end.getTime())) + SEARCH_SLACK_MS);
  const others = await prisma.run.findMany({
    where: {
      userId: params.userId,
      trackId: run.trackId,
      id: { not: run.id },
      unconfirmedAt: { not: null },
      OR: [{ sortAt: { gte: from, lte: to } }, { sessionCompletedAt: { gte: from, lte: to } }],
    },
    select: {
      id: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      suggestedChanges: true,
      suggestedPreRun: true,
      carRating: true,
      handlingAssessmentJson: true,
      detectedImportedLapSession: { select: SESSION_SELECT },
      linkedImportedLapSessions: { select: SESSION_SELECT },
    },
    take: 60,
  });
  if (others.length === 0) return [];

  const toAbsorb = planSameOutingAbsorption(
    runSpans,
    others.map((other) => ({
      id: other.id,
      spans: spansOf([other.detectedImportedLapSession, ...other.linkedImportedLapSessions], fallbackZone),
      writtenOn: runHasDriverWriting(other),
    }))
  );

  const absorbed: string[] = [];
  for (const otherId of toAbsorb) {
    const done = await prisma.$transaction(async (tx) => {
      // Confirmed in the meantime (a Confirm tap racing this save): it is the driver's now.
      const still = await tx.run.findFirst({
        where: { id: otherId, userId: params.userId, unconfirmedAt: { not: null } },
        select: { importedLapTimeSessionId: true },
      });
      if (!still) return false;
      await tx.run.update({ where: { id: otherId }, data: { importedLapTimeSessionId: null } });
      await tx.importedLapTimeSession.updateMany({
        where: {
          userId: params.userId,
          OR: [
            { linkedRunId: otherId },
            ...(still.importedLapTimeSessionId ? [{ id: still.importedLapTimeSessionId }] : []),
          ],
        },
        data: { linkedRunId: run.id },
      });
      await tx.run.delete({ where: { id: otherId } });
      return true;
    });
    if (done) absorbed.push(otherId);
  }
  return absorbed;
}
