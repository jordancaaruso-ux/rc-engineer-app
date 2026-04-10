import "server-only";

import { prisma } from "@/lib/prisma";
import {
  computeIncludedLapMetricsFromRun,
  getIncludedLapDashboardMetrics,
  importedSetToLapRows,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { buildSetupDiffRows, normalizeSetupData } from "@/lib/setupDiff";
import { displayRunNotes } from "@/lib/runNotes";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";

export type EngineerContextPacketV1 = {
  version: 1;
  generatedAtIso: string;
  user: { id: string };
  latestRun: null | {
    id: string;
    createdAtIso: string;
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    eventName: string | null;
    lapSummary: {
      lapCount: number;
      bestLapSeconds: number | null;
      avgTop5Seconds: number | null;
    } | null;
    setup: {
      hasSetupSnapshot: boolean;
      /** Keys that differ vs previous run on same car (not vs document baseline). */
      keysChangedFromPreviousRun: string[];
      keysChangedFromPreviousRunCount: number;
    };
    notesPreview: string | null;
  };
  previousRun: null | {
    id: string;
    createdAtIso: string;
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    lapSummary: {
      lapCount: number;
      bestLapSeconds: number | null;
      avgTop5Seconds: number | null;
    } | null;
  };
  comparison: null | {
    lapDeltaSummary: {
      bestLapDeltaSeconds: number | null;
      avgTop5DeltaSeconds: number | null;
      direction: "improved" | "regressed" | "flat" | "unknown";
    };
    setupChangeSummary: {
      changedKeyCount: number;
      changedKeysSample: string[];
    };
  };
  thingsToTry: Array<{ id: string; text: string }>;
};

type LapSummary = {
  lapCount: number;
  bestLapSeconds: number | null;
  avgTop5Seconds: number | null;
} | null;

function clampNotePreview(raw: string | null | undefined, max = 220): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function lapSummaryFromRun(run: { lapTimes: unknown; lapSession?: unknown } | null): LapSummary {
  if (!run) return null;
  const m = computeIncludedLapMetricsFromRun(run);
  return {
    lapCount: m.lapCount,
    bestLapSeconds: m.bestLap ?? null,
    avgTop5Seconds: (m as { averageTop5?: number | null }).averageTop5 ?? null,
  };
}

function deltaDirection(delta: number | null): "improved" | "regressed" | "flat" | "unknown" {
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < 1e-6) return "flat";
  return delta < 0 ? "improved" : "regressed";
}

/**
 * Phase 5 V1 context packet:
 * - deterministic, compact, user-scoped
 * - does not include raw lap-by-lap tables
 */
export async function buildEngineerContextPacketV1(userId: string): Promise<EngineerContextPacketV1> {
  const thingsToTry = await prisma.actionItem.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, text: true },
  });

  const latest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sessionType: true,
      meetingSessionType: true,
      meetingSessionCode: true,
      sessionLabel: true,
      lapTimes: true,
      lapSession: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
      event: { select: { name: true } },
      setupSnapshot: { select: { id: true, data: true } },
      carId: true,
    },
  });

  if (!latest) {
    return {
      version: 1,
      generatedAtIso: new Date().toISOString(),
      user: { id: userId },
      latestRun: null,
      previousRun: null,
      comparison: null,
      thingsToTry: thingsToTry.map((t) => ({ id: t.id, text: t.text })),
    };
  }

  const prev = latest.carId
    ? await prisma.run.findFirst({
        where: { userId, carId: latest.carId, id: { not: latest.id } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          sessionType: true,
          meetingSessionType: true,
          meetingSessionCode: true,
          sessionLabel: true,
          lapTimes: true,
          lapSession: true,
          carNameSnapshot: true,
          trackNameSnapshot: true,
          car: { select: { name: true } },
          track: { select: { name: true } },
          setupSnapshot: { select: { id: true, data: true } },
        },
      })
    : null;

  const latestCarName = latest.car?.name ?? latest.carNameSnapshot ?? "—";
  const latestTrackName = latest.track?.name ?? latest.trackNameSnapshot ?? "—";
  const latestSession = formatRunSessionDisplay({
    sessionType: latest.sessionType,
    meetingSessionType: latest.meetingSessionType,
    meetingSessionCode: latest.meetingSessionCode,
    sessionLabel: latest.sessionLabel,
  });

  const prevCarName = prev?.car?.name ?? prev?.carNameSnapshot ?? latestCarName;
  const prevTrackName = prev?.track?.name ?? prev?.trackNameSnapshot ?? "—";
  const prevSession = prev
    ? formatRunSessionDisplay({
        sessionType: prev.sessionType,
        meetingSessionType: prev.meetingSessionType,
        meetingSessionCode: prev.meetingSessionCode,
        sessionLabel: prev.sessionLabel,
      })
    : "";

  const latestLap = lapSummaryFromRun(latest);
  const prevLap = prev ? lapSummaryFromRun(prev) : null;

  const bestDelta =
    latestLap?.bestLapSeconds != null && prevLap?.bestLapSeconds != null
      ? latestLap.bestLapSeconds - prevLap.bestLapSeconds
      : null;
  const top5Delta =
    latestLap?.avgTop5Seconds != null && prevLap?.avgTop5Seconds != null
      ? latestLap.avgTop5Seconds - prevLap.avgTop5Seconds
      : null;

  const keysChangedFromPreviousRun = prev
    ? listSetupKeysChangedBetweenSnapshots(latest.setupSnapshot?.data, prev.setupSnapshot?.data)
    : [];

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    user: { id: userId },
    latestRun: {
      id: latest.id,
      createdAtIso: latest.createdAt.toISOString(),
      createdAtLabel: formatRunCreatedAtDateTime(latest.createdAt),
      sessionTypeLabel: latestSession,
      carName: latestCarName,
      trackName: latestTrackName,
      eventName: latest.event?.name ?? null,
      lapSummary: latestLap,
      setup: {
        hasSetupSnapshot: Boolean(latest.setupSnapshot?.id),
        keysChangedFromPreviousRun,
        keysChangedFromPreviousRunCount: keysChangedFromPreviousRun.length,
      },
      notesPreview: clampNotePreview(latest.notes ?? latest.driverNotes ?? latest.handlingProblems ?? null),
    },
    previousRun: prev
      ? {
          id: prev.id,
          createdAtIso: prev.createdAt.toISOString(),
          createdAtLabel: formatRunCreatedAtDateTime(prev.createdAt),
          sessionTypeLabel: prevSession,
          carName: prevCarName,
          trackName: prevTrackName,
          lapSummary: prevLap,
        }
      : null,
    comparison: prev
      ? {
          lapDeltaSummary: {
            bestLapDeltaSeconds: bestDelta,
            avgTop5DeltaSeconds: top5Delta,
            direction: deltaDirection(top5Delta ?? bestDelta),
          },
          setupChangeSummary: {
            changedKeyCount: keysChangedFromPreviousRun.length,
            changedKeysSample: keysChangedFromPreviousRun.slice(0, 12),
          },
        }
      : null,
    thingsToTry: thingsToTry.map((t) => ({ id: t.id, text: t.text })),
  };
}

const MAX_SETUP_DIFF_ROWS = 55;

/** User-selected runs for engineer chat (lap + setup diff + imported drivers on primary). */
export type EngineerFocusedRunPairContext = {
  primaryRunId: string;
  compareRunId: string | null;
  primary: {
    id: string;
    whenLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    eventName: string | null;
    carId: string | null;
    lapSummary: {
      lapCount: number;
      bestLapSeconds: number | null;
      avgTop5Seconds: number | null;
      avgTop10Seconds: number | null;
      consistencyScore: number | null;
    };
    notesPreview: string | null;
  };
  compare: null | EngineerFocusedRunPairContext["primary"];
  lapComparison: null | {
    /** primary best − compare best (negative ⇒ primary faster). */
    bestLapDeltaSeconds: number | null;
    avgTop5DeltaSeconds: number | null;
    avgTop10DeltaSeconds: number | null;
    bestLapOutcome: "primary_faster" | "compare_faster" | "flat" | "unknown";
  };
  setupComparison: null | {
    comparable: boolean;
    reasonIfNot: string | null;
    sameCar: boolean;
    changedRows: Array<{ label: string; primary: string; compare: string }>;
    changedRowCount: number;
    truncated: boolean;
  };
  importedDriversOnPrimary: Array<{
    label: string;
    lapCount: number;
    bestLapSeconds: number | null;
    avgTop5Seconds: number | null;
  }>;
};

function lapDashboardFromRun(run: { lapTimes: unknown; lapSession?: unknown }) {
  const rows = primaryLapRowsFromRun(run);
  return getIncludedLapDashboardMetrics(rows);
}

function bestLapOutcomeFromDelta(
  delta: number | null
): "primary_faster" | "compare_faster" | "flat" | "unknown" {
  if (delta == null || !Number.isFinite(delta)) return "unknown";
  if (Math.abs(delta) < 1e-6) return "flat";
  return delta < 0 ? "primary_faster" : "compare_faster";
}

const focusedRunSelect = {
  id: true,
  createdAt: true,
  sessionCompletedAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  lapTimes: true,
  lapSession: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  carId: true,
  carNameSnapshot: true,
  trackNameSnapshot: true,
  car: { select: { id: true, name: true } },
  track: { select: { name: true } },
  event: { select: { name: true } },
  setupSnapshot: { select: { data: true } },
  importedLapSets: {
    select: {
      driverName: true,
      displayName: true,
      laps: { orderBy: { lapNumber: "asc" as const } },
    },
  },
} as const;

function runSliceFromRow(
  row: {
    id: string;
    createdAt: Date;
    sessionCompletedAt: Date | null;
    sessionType: string;
    meetingSessionType: string | null;
    meetingSessionCode: string | null;
    sessionLabel: string | null;
    lapTimes: unknown;
    lapSession: unknown;
    notes: string | null;
    driverNotes: string | null;
    handlingProblems: string | null;
    carNameSnapshot: string | null;
    trackNameSnapshot: string | null;
    car: { name: string } | null;
    track: { name: string } | null;
    event: { name: string } | null;
    carId: string | null;
  }
): EngineerFocusedRunPairContext["primary"] {
  const when = resolveRunDisplayInstant({
    createdAt: row.createdAt,
    sessionCompletedAt: row.sessionCompletedAt,
  });
  const lap = lapDashboardFromRun(row);
  return {
    id: row.id,
    whenLabel: formatRunCreatedAtDateTime(when),
    sessionTypeLabel: formatRunSessionDisplay({
      sessionType: row.sessionType,
      meetingSessionType: row.meetingSessionType,
      meetingSessionCode: row.meetingSessionCode,
      sessionLabel: row.sessionLabel,
    }),
    carName: row.car?.name ?? row.carNameSnapshot ?? "—",
    trackName: row.track?.name ?? row.trackNameSnapshot ?? "—",
    eventName: row.event?.name ?? null,
    carId: row.carId,
    lapSummary: {
      lapCount: lap.lapCount,
      bestLapSeconds: lap.bestLap,
      avgTop5Seconds: lap.avgTop5,
      avgTop10Seconds: lap.avgTop10,
      consistencyScore: lap.consistencyScore,
    },
    notesPreview: clampNotePreview(displayRunNotes(row)),
  };
}

/**
 * Deterministic context for comparing two user runs (any date). Setup diff only when same `carId`.
 */
export async function buildFocusedRunPairContext(
  userId: string,
  primaryRunId: string,
  compareRunId: string | null | undefined
): Promise<EngineerFocusedRunPairContext | null> {
  const primary = await prisma.run.findFirst({
    where: { id: primaryRunId.trim(), userId },
    select: focusedRunSelect,
  });
  if (!primary) return null;

  const compare =
    compareRunId && compareRunId.trim() && compareRunId.trim() !== primaryRunId.trim()
      ? await prisma.run.findFirst({
          where: { id: compareRunId.trim(), userId },
          select: focusedRunSelect,
        })
      : null;

  const primarySlice = runSliceFromRow(primary);
  const compareSlice = compare ? runSliceFromRow(compare) : null;

  let lapComparison: EngineerFocusedRunPairContext["lapComparison"] = null;
  if (compareSlice) {
    const pb = primarySlice.lapSummary.bestLapSeconds;
    const cb = compareSlice.lapSummary.bestLapSeconds;
    const p5 = primarySlice.lapSummary.avgTop5Seconds;
    const c5 = compareSlice.lapSummary.avgTop5Seconds;
    const p10 = primarySlice.lapSummary.avgTop10Seconds;
    const c10 = compareSlice.lapSummary.avgTop10Seconds;
    const bestDelta =
      pb != null && cb != null && Number.isFinite(pb) && Number.isFinite(cb) ? pb - cb : null;
    const top5Delta =
      p5 != null && c5 != null && Number.isFinite(p5) && Number.isFinite(c5) ? p5 - c5 : null;
    const top10Delta =
      p10 != null && c10 != null && Number.isFinite(p10) && Number.isFinite(c10) ? p10 - c10 : null;
    lapComparison = {
      bestLapDeltaSeconds: bestDelta,
      avgTop5DeltaSeconds: top5Delta,
      avgTop10DeltaSeconds: top10Delta,
      bestLapOutcome: bestLapOutcomeFromDelta(bestDelta),
    };
  }

  let setupComparison: EngineerFocusedRunPairContext["setupComparison"] = null;
  if (compareSlice) {
    const sameCar =
      Boolean(primarySlice.carId && compareSlice.carId && primarySlice.carId === compareSlice.carId);
    if (!sameCar) {
      setupComparison = {
        comparable: false,
        reasonIfNot: "Runs are on different cars — setup field diff not shown.",
        sameCar: false,
        changedRows: [],
        changedRowCount: 0,
        truncated: false,
      };
    } else {
      const a = normalizeSetupData(primary.setupSnapshot?.data);
      const b = normalizeSetupData(compare!.setupSnapshot?.data);
      const rows = buildSetupDiffRows(a, b).filter((r) => r.changed);
      const changedRowCount = rows.length;
      const slice = rows.slice(0, MAX_SETUP_DIFF_ROWS);
      setupComparison = {
        comparable: true,
        reasonIfNot: null,
        sameCar: true,
        changedRows: slice.map((r) => ({
          label: r.unit ? `${r.label} (${r.unit})` : r.label,
          primary: r.current,
          compare: r.previous ?? "—",
        })),
        changedRowCount,
        truncated: changedRowCount > slice.length,
      };
    }
  }

  const importedDriversOnPrimary: EngineerFocusedRunPairContext["importedDriversOnPrimary"] = [];
  for (const set of primary.importedLapSets ?? []) {
    const label = (set.displayName?.trim() || set.driverName).trim() || "Imported";
    const laps = importedSetToLapRows(
      set.laps.map((l) => ({
        lapNumber: l.lapNumber,
        lapTimeSeconds: l.lapTimeSeconds,
        isIncluded: l.isIncluded,
      }))
    );
    const m = getIncludedLapDashboardMetrics(laps);
    importedDriversOnPrimary.push({
      label,
      lapCount: m.lapCount,
      bestLapSeconds: m.bestLap,
      avgTop5Seconds: m.avgTop5,
    });
  }

  return {
    primaryRunId: primary.id,
    compareRunId: compareSlice?.id ?? null,
    primary: primarySlice,
    compare: compareSlice,
    lapComparison,
    setupComparison,
    importedDriversOnPrimary,
  };
}
