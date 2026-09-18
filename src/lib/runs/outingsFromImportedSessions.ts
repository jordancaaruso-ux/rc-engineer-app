import { instantToWallClockAsUtc } from "@/lib/eventActive";
import {
  sessionCompletedAtIsoFromImportedPayload,
  sessionUtcOffsetMinutesFromImportedPayload,
} from "@/lib/lapImport/fromPayload";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
import { trackClockTime } from "@/lib/lapImport/trackClock";
import { importedSessionInstantToReal } from "@/lib/runSessionCompletedAt";
import type { OutingSession } from "@/lib/runs/groupOutings";
import {
  durationFromDrivers,
  outingKindFor,
  spanFrom,
  timeAnchorFor,
  type Span,
} from "@/lib/runs/outingSpan";

/**
 * From a stored timing import (or a run) to the window it covered on track. The only place the
 * per-source facts — wall clock vs instant, start vs end stamp, laps in the payload — are turned
 * into the plain `Span` the outing rule compares. Shared by the timing sweep's evening pass and
 * the wizard's "Add N other runs" so both group a day the same way.
 *
 * Two clocks, never mixed in one comparison. The evening pass works in real instants, reading
 * wall clocks in the track's zone (`outingSessionFromImportedRow`). A save works on the track's
 * own clock (`trackClockOutingFromImportedRow`), which every timing site posts, so where the
 * driver is when they log the day changes nothing.
 */

export type ImportedRowForOuting = {
  id: string;
  sourceUrl: string;
  parserId: string;
  parsedPayload: unknown;
  sessionCompletedAt: Date | null;
};

function storedSessionIso(row: ImportedRowForOuting): string | null {
  return row.sessionCompletedAt?.toISOString() ?? sessionCompletedAtIsoFromImportedPayload(row.parsedPayload);
}

function outingAt(row: ImportedRowForOuting, at: Date): OutingSession {
  const drivers = rawSessionDriversFromImportedPayload(row.parsedPayload) ?? [];
  const lapCount = drivers.reduce((max, d) => Math.max(max, d.laps.length), 0);
  const kind = outingKindFor(row.parserId, row.sourceUrl);
  const span = spanFrom(at, durationFromDrivers(drivers), timeAnchorFor(row.parserId, row.sourceUrl));
  return { id: row.id, kind, ...span, driverCount: drivers.length, lapCount };
}

export function outingSessionFromImportedRow(
  row: ImportedRowForOuting,
  /** Zone to read a wall-clock timing site in — the run's own, else the track's. */
  zone: string | null,
): OutingSession | null {
  const rawIso = storedSessionIso(row);
  if (!rawIso) return null;
  const raw = new Date(rawIso);
  if (Number.isNaN(raw.getTime())) return null;
  return outingAt(row, importedSessionInstantToReal(raw, row.sourceUrl, zone));
}

/**
 * The import's window on the track's clock (`lapImport/trackClock.ts`). `fallbackTimeZone` only
 * reads a Speedhive practice import saved before the track's offset was kept.
 */
export function trackClockOutingFromImportedRow(
  row: ImportedRowForOuting,
  fallbackTimeZone: string | null,
): OutingSession | null {
  const onTrack = trackClockTime({
    iso: storedSessionIso(row),
    parserId: row.parserId,
    sourceUrl: row.sourceUrl,
    utcOffsetMinutes: sessionUtcOffsetMinutesFromImportedPayload(row.parsedPayload),
    fallbackTimeZone,
  });
  return onTrack ? outingAt(row, onTrack) : null;
}

export type RunForOutingSpan = {
  sortAt: Date;
  sessionCompletedAt: Date | null;
  lapTimes: unknown;
  localTimeZone: string | null;
  /**
   * The run's primary timing session. Prisma names this relation `detectedImportedLapSession`
   * (it rides `importedLapTimeSessionId`); a select spelled any other way passes `tsc` here and
   * fails at runtime.
   */
  detectedImportedLapSession: ImportedRowForOuting | null;
};

function runLapSeconds(run: RunForOutingSpan): number[] {
  return Array.isArray(run.lapTimes)
    ? run.lapTimes.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    : [];
}

/**
 * An existing run's time on track: its primary session's window when it has one, else its own
 * stamp plus its laps. A run with no laps is not an outing — it is a claimant waiting for one.
 */
export function spanForExistingRun(run: RunForOutingSpan, zone: string | null): Span | null {
  if (run.detectedImportedLapSession) {
    const s = outingSessionFromImportedRow(run.detectedImportedLapSession, run.localTimeZone ?? zone);
    if (s) return { start: s.start, end: s.end };
  }
  const laps = runLapSeconds(run);
  if (laps.length === 0) return null;
  const instant = run.sessionCompletedAt ?? run.sortAt;
  return spanFrom(
    instant,
    laps.reduce((a, b) => a + b, 0),
    "start",
  );
}

/**
 * {@link spanForExistingRun} on the track's clock. A run with no timing session has only its own
 * stamp, a real instant, and it is read in the zone the run was logged in: at the track, that is
 * the track's clock.
 */
export function trackClockSpanForExistingRun(
  run: RunForOutingSpan,
  fallbackTimeZone: string | null,
): Span | null {
  if (run.detectedImportedLapSession) {
    const s = trackClockOutingFromImportedRow(run.detectedImportedLapSession, fallbackTimeZone);
    if (s) return { start: s.start, end: s.end };
  }
  const laps = runLapSeconds(run);
  if (laps.length === 0) return null;
  const instant = run.sessionCompletedAt ?? run.sortAt;
  const zone = run.localTimeZone ?? fallbackTimeZone;
  let onTrack = instant;
  if (zone) {
    try {
      onTrack = instantToWallClockAsUtc(instant, zone);
    } catch {
      // A zone Intl does not know: the stamp as it is.
    }
  }
  return spanFrom(
    onTrack,
    laps.reduce((a, b) => a + b, 0),
    "start",
  );
}
