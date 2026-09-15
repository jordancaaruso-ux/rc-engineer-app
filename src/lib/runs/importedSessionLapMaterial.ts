import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import {
  rawSessionDriversFromImportedPayload,
  sessionHintNameFromPayload,
} from "@/lib/lapImport/importedIngestPlan";
import { pickPrimarySessionDriver } from "@/lib/lapImport/pickPrimarySessionDriver";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { buildLapSessionV1 } from "@/lib/lapSession/buildSession";
import { computePersistedRunLapSummary } from "@/lib/lapAnalysis";
import type { ImportedLapSetInput } from "@/lib/runs/writeRunImportedLapSets";

/**
 * Everything a run stores about its laps, built from a stored timing import the way the lap step
 * does when a driver attaches a session by hand: the primary driver picked, the same
 * include/exclude pass, the lap session document, the summary figures, and one lap set per
 * driver in the session. Shared by the "Add N other runs" backfill and the timing sweep so a run
 * the app filed carries exactly what a hand-attached one would.
 */

export type ImportedSessionForLapMaterial = {
  id: string;
  sourceUrl: string;
  parserId: string;
  parsedPayload: unknown;
  sessionCompletedAt: Date | null;
  createdAt: Date;
};

export type RunLapMaterial = {
  lapTimes: number[];
  lapSession: ReturnType<typeof buildLapSessionV1>;
  lapSummary: ReturnType<typeof computePersistedRunLapSummary>;
  lapSets: ImportedLapSetInput[];
  primaryDriverId: string;
};

export function buildRunLapMaterial(
  session: ImportedSessionForLapMaterial,
  opts: {
    liveRcDriverId: string | null;
    liveRcDriverName: string | null;
    eventId: string | null;
  },
): RunLapMaterial | null {
  const drivers = rawSessionDriversFromImportedPayload(session.parsedPayload);
  if (!drivers || drivers.length === 0) return null;

  const primary = pickPrimarySessionDriver(drivers, {
    liveRcDriverId: opts.liveRcDriverId,
    liveRcDriverName: opts.liveRcDriverName,
    sessionHintName: sessionHintNameFromPayload(session.parsedPayload),
  });

  const rowsByDriverId = new Map(
    drivers.map((d) => [
      d.driverId,
      applyMedianBandAutoExclude(
        d.laps.map((t, idx) => ({ lapNumber: idx + 1, lapTimeSeconds: t, isIncluded: true })),
      ),
    ]),
  );
  const primaryRows = rowsByDriverId.get(primary.driverId)!;
  const lapTimes = primaryRows.map((r) => r.lapTimeSeconds);
  const lapSession = buildLapSessionV1({
    laps: lapTimes,
    sourceKind: "url",
    sourceDetail: session.sourceUrl,
    parserId: session.parserId,
    context: { eventId: opts.eventId, sessionLabel: null },
    perLap: primaryRows.map((r) => ({ isIncluded: r.isIncluded })),
  });
  const lapSummary = computePersistedRunLapSummary({ lapTimes, lapSession });

  // Per-set time stays the stored wall-clock value — its display sites freeze it in UTC.
  const setTimeIso =
    sessionCompletedAtIsoFromImportedPayload(session.parsedPayload) ??
    session.sessionCompletedAt?.toISOString() ??
    session.createdAt.toISOString();
  const lapSets: ImportedLapSetInput[] = drivers.map((d) => ({
    sourceUrl: session.sourceUrl,
    driverId: d.driverId,
    driverName: d.driverName,
    normalizedName: d.normalizedName,
    isPrimaryUser: d.driverId === primary.driverId,
    sessionCompletedAt: setTimeIso,
    laps: rowsByDriverId.get(d.driverId)!,
  }));

  return { lapTimes, lapSession, lapSummary, lapSets, primaryDriverId: primary.driverId };
}
