import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { rawSessionDriversFromImportedPayload } from "@/lib/lapImport/importedIngestPlan";
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
 */

export type ImportedRowForOuting = {
  id: string;
  sourceUrl: string;
  parserId: string;
  parsedPayload: unknown;
  sessionCompletedAt: Date | null;
};

export function outingSessionFromImportedRow(
  row: ImportedRowForOuting,
  /** Zone to read a wall-clock timing site in — the run's own, else the track's. */
  zone: string | null,
): OutingSession | null {
  const rawIso =
    row.sessionCompletedAt?.toISOString() ?? sessionCompletedAtIsoFromImportedPayload(row.parsedPayload);
  if (!rawIso) return null;
  const raw = new Date(rawIso);
  if (Number.isNaN(raw.getTime())) return null;
  const instant = importedSessionInstantToReal(raw, row.sourceUrl, zone);

  const drivers = rawSessionDriversFromImportedPayload(row.parsedPayload) ?? [];
  const lapCount = drivers.reduce((max, d) => Math.max(max, d.laps.length), 0);
  const kind = outingKindFor(row.parserId, row.sourceUrl);
  const span = spanFrom(instant, durationFromDrivers(drivers), timeAnchorFor(row.parserId, row.sourceUrl));
  return { id: row.id, kind, ...span, driverCount: drivers.length, lapCount };
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

/**
 * An existing run's time on track: its primary session's window when it has one, else its own
 * stamp plus its laps. A run with no laps is not an outing — it is a claimant waiting for one.
 */
export function spanForExistingRun(run: RunForOutingSpan, zone: string | null): Span | null {
  if (run.detectedImportedLapSession) {
    const s = outingSessionFromImportedRow(run.detectedImportedLapSession, run.localTimeZone ?? zone);
    if (s) return { start: s.start, end: s.end };
  }
  const laps = Array.isArray(run.lapTimes)
    ? run.lapTimes.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    : [];
  if (laps.length === 0) return null;
  const instant = run.sessionCompletedAt ?? run.sortAt;
  return spanFrom(
    instant,
    laps.reduce((a, b) => a + b, 0),
    "start",
  );
}
