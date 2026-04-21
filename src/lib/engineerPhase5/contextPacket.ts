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
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { buildSetupDiffRows, normalizeSetupData } from "@/lib/setupDiff";
import { displayRunNotesTextOnly } from "@/lib/runNotes";
import { formatHandlingAssessmentForEngineer } from "@/lib/runHandlingAssessment";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { computeFieldImportSessionFromSets } from "@/lib/lapField/fieldImportSession";
import {
  buildRcEffectHintsFromChangedRows,
  type RcEffectHint,
} from "@/lib/engineerPhase5/rcEffectHintsFromSetupComparison";
import { buildVehicleDynamicsKbQueryFromChangedKeys } from "@/lib/engineerPhase5/setupCompareKbQuery";
import {
  searchVehicleDynamicsKb,
  type VehicleDynamicsKbSnippet,
} from "@/lib/engineerPhase5/vehicleDynamicsKb";
import {
  SETUP_COMPARE_CORNER_KEY_LEGEND,
  collapseSetupDiffRowsForEngineer,
} from "@/lib/engineerPhase5/collapseSetupDiffForEngineer";
import {
  buildBulkheadFrontVsRearAvgCompareNote,
  buildFrontRearAxleNetNotes,
  buildLowerArmAntiGeometryNotes,
  buildUpperInnerBulkheadSplitNotes,
} from "@/lib/engineerPhase5/setupCompareAxleNet";

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
    handlingPreview: string | null;
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

function clampHandlingPreview(raw: string | null | undefined): string | null {
  return clampNotePreview(raw, 800);
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
      handlingAssessmentJson: true,
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
    ? listSetupKeysChangedBetweenSnapshots(latest.setupSnapshot?.data, prev.setupSnapshot?.data, {
        keyFilter: isTuningComparisonKey,
      })
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
      notesPreview: clampNotePreview(displayRunNotesTextOnly(latest)),
      handlingPreview: clampHandlingPreview(
        formatHandlingAssessmentForEngineer(latest.handlingAssessmentJson)
      ),
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

const SETUP_COMPARE_COLUMN_NOTE =
  "Each changedRow: `primary` = setup value on the focused primary run; `compare` = value on the compare run. " +
  "Change compare→primary (shim stack mm): primary minus compare — positive means a raised stack on primary vs compare. " +
  "Do not swap columns or invert this sign. Use `rcEffectHints` for roll-centre direction on upper inner and under lower arm shims. " +
  SETUP_COMPARE_CORNER_KEY_LEGEND +
  " When both inner pickups on an axle (FF & FR or RF & RR) show the same compare→primary change, the table uses one merged row—do not repeat the same axle twice.";

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
    handlingPreview: string | null;
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
    /** How to read values (primary = focused run, compare = other run). */
    columnReadingNote: string | null;
    changedRows: Array<{ key: string; label: string; primary: string; compare: string }>;
    /** Deterministic RC sign lines for upper inner + under lower arm (compare → primary). */
    rcEffectHints: RcEffectHint[];
    changedRowCount: number;
    truncated: boolean;
    /**
     * When only one axle’s upper-link keys changed vs compare: reminds the model to interpret
     * roll-centre balance front vs rear, not that axle in isolation.
     */
    rollCentreBalanceNote: string | null;
    /** Deterministic per-axle RC net from changed shims (compare→primary); prevents summary sign errors. */
    frontAxleNetNote: string | null;
    rearAxleNetNote: string | null;
    /**
     * Under–lower-arm bulkhead pickup split (FF–FR / RF–RR) for anti-dive / anti-squat vs averaged RC on the axle.
     */
    frontLowerArmAntiGeometryNote: string | null;
    rearLowerArmAntiGeometryNote: string | null;
    /** Upper-inner bulkhead pickup split vs compare (forward vs rearward inner stacks on the axle). */
    frontUpperInnerBulkheadSplitNote: string | null;
    rearUpperInnerBulkheadSplitNote: string | null;
    /** mean(FF,FR) vs mean(RF,RR) for upper inner and under lower; f_avg − r_avg compare→primary. */
    bulkheadFrontVsRearAvgNote: string | null;
  };
  importedDriversOnPrimary: Array<{
    label: string;
    lapCount: number;
    bestLapSeconds: number | null;
    avgTop5Seconds: number | null;
  }>;
  /** When ≥2 imported drivers on the primary run: rank / gap / stint fade vs session best. */
  fieldImportSession: null | {
    driverCount: number;
    sessionBestLapSeconds: number | null;
    ranked: Array<{
      label: string;
      isPrimaryUser: boolean;
      rank: number;
      bestLapSeconds: number | null;
      gapToSessionBestSeconds: number | null;
      fadeSeconds: number | null;
    }>;
  };
  /**
   * vehicle-dynamics KB sections chosen by keyword overlap with changed setup keys—use for handling
   * text alongside rcEffectHints (compare→primary direction is authoritative).
   */
  setupCompareKbSnippets: VehicleDynamicsKbSnippet[];
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

/** When only one axle’s upper-link keys are in the diff, steer the model toward balance reasoning. */
function rollCentreBalanceNoteFromChangedKeys(keys: readonly string[]): string | null {
  const s = new Set(keys);
  const frontUpper =
    s.has("upper_inner_shims_ff") ||
    s.has("upper_inner_shims_fr") ||
    s.has("upper_outer_shims_front");
  const rearUpper =
    s.has("upper_inner_shims_rf") ||
    s.has("upper_inner_shims_rr") ||
    s.has("upper_outer_shims_rear");
  if (frontUpper && !rearUpper) {
    return (
      "This diff includes front upper-link keys (upper inner and/or upper outer) but no rear upper_inner or upper_outer keys—rear upper link is unchanged vs compare. " +
      "Interpret handling as a shift in roll-centre balance front vs rear (vehicleDynamicsKb: one axle upper link changes, upper link balance, per-end theory), not only isolated front effects."
    );
  }
  if (rearUpper && !frontUpper) {
    return (
      "This diff includes rear upper-link keys but no front upper_inner or upper_outer keys—front upper link is unchanged vs compare. " +
      "Interpret as roll-centre balance rear vs front per vehicleDynamicsKb, not only isolated rear effects."
    );
  }
  return null;
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
  handlingAssessmentJson: true,
  carId: true,
  trackId: true,
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
      isPrimaryUser: true,
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
    handlingAssessmentJson: unknown;
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
    notesPreview: clampNotePreview(displayRunNotesTextOnly(row)),
    handlingPreview: clampHandlingPreview(
      formatHandlingAssessmentForEngineer(row.handlingAssessmentJson)
    ),
  };
}

async function loadCompareRunForFocusedContext(
  viewerId: string,
  primaryRunId: string,
  primaryTrackId: string | null,
  compareRunId: string | null | undefined
) {
  if (!compareRunId?.trim()) return null;
  const cid = compareRunId.trim();
  if (cid === primaryRunId.trim()) return null;

  const own = await prisma.run.findFirst({
    where: { id: cid, userId: viewerId },
    select: focusedRunSelect,
  });
  if (own) return own;

  const other = await prisma.run.findFirst({
    where: { id: cid },
    select: { userId: true, trackId: true },
  });
  if (!other) return null;

  const link = await prisma.teammateLink.findFirst({
    where: { userId: viewerId, peerUserId: other.userId },
    select: { id: true },
  });
  if (!link) return null;
  if (!primaryTrackId || !other.trackId || primaryTrackId !== other.trackId) return null;

  return prisma.run.findFirst({
    where: { id: cid },
    select: focusedRunSelect,
  });
}

/**
 * Deterministic context for comparing two user runs (any date). Setup diff only when same `carId`.
 * Compare run may be the viewer's or a teammate's (requires TeammateLink + same track as primary).
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

  const compare = await loadCompareRunForFocusedContext(
    userId,
    primary.id,
    primary.trackId,
    compareRunId
  );

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
  let setupCompareKbSnippets: VehicleDynamicsKbSnippet[] = [];
  if (compareSlice) {
    const sameCar =
      Boolean(primarySlice.carId && compareSlice.carId && primarySlice.carId === compareSlice.carId);
    if (!sameCar) {
      setupComparison = {
        comparable: false,
        reasonIfNot: "Runs are on different cars — setup field diff not shown.",
        sameCar: false,
        columnReadingNote: null,
        changedRows: [],
        rcEffectHints: [],
        changedRowCount: 0,
        truncated: false,
        rollCentreBalanceNote: null,
        frontAxleNetNote: null,
        rearAxleNetNote: null,
        frontLowerArmAntiGeometryNote: null,
        rearLowerArmAntiGeometryNote: null,
        frontUpperInnerBulkheadSplitNote: null,
        rearUpperInnerBulkheadSplitNote: null,
        bulkheadFrontVsRearAvgNote: null,
      };
    } else {
      const a = normalizeSetupData(primary.setupSnapshot?.data);
      const b = normalizeSetupData(compare!.setupSnapshot?.data);
      const rows = buildSetupDiffRows(a, b).filter(
        (r) => r.changed && isTuningComparisonKey(r.key)
      );
      const rawChangedCount = rows.length;
      const slice = rows.slice(0, MAX_SETUP_DIFF_ROWS);
      const changedKeysInSlice = slice.map((r) => r.key);
      const rollCentreBalanceNote = rollCentreBalanceNoteFromChangedKeys(changedKeysInSlice);
      const changedRowsRaw = slice.map((r) => ({
        key: r.key,
        label: r.unit ? `${r.label} (${r.unit})` : r.label,
        primary: r.current,
        compare: r.previous ?? "—",
      }));
      const changedRows = collapseSetupDiffRowsForEngineer(changedRowsRaw);
      const { frontAxleNetNote, rearAxleNetNote } = buildFrontRearAxleNetNotes(changedRowsRaw);
      const { frontLowerArmAntiGeometryNote, rearLowerArmAntiGeometryNote } =
        buildLowerArmAntiGeometryNotes(a, b);
      const { frontUpperInnerBulkheadSplitNote, rearUpperInnerBulkheadSplitNote } =
        buildUpperInnerBulkheadSplitNotes(a, b);
      const bulkheadFrontVsRearAvgNote = buildBulkheadFrontVsRearAvgCompareNote(a, b);
      setupComparison = {
        comparable: true,
        reasonIfNot: null,
        sameCar: true,
        columnReadingNote: SETUP_COMPARE_COLUMN_NOTE,
        changedRows,
        rcEffectHints: buildRcEffectHintsFromChangedRows(changedRows),
        changedRowCount: changedRows.length,
        truncated: rawChangedCount > slice.length,
        rollCentreBalanceNote,
        frontAxleNetNote,
        rearAxleNetNote,
        frontLowerArmAntiGeometryNote,
        rearLowerArmAntiGeometryNote,
        frontUpperInnerBulkheadSplitNote,
        rearUpperInnerBulkheadSplitNote,
        bulkheadFrontVsRearAvgNote,
      };
      if (rawChangedCount > 0) {
        let kbQuery = buildVehicleDynamicsKbQueryFromChangedKeys(changedKeysInSlice);
        if (rollCentreBalanceNote) {
          kbQuery += " upper link balance front rear roll centre";
        }
        if (changedKeysInSlice.some((k) => k.startsWith("under_lower_arm"))) {
          kbQuery += " anti dive anti squat bulkhead pickup split lower arm";
        }
        setupCompareKbSnippets = await searchVehicleDynamicsKb(kbQuery, 10);
      }
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

  const fieldImportSession =
    computeFieldImportSessionFromSets(
      (primary.importedLapSets ?? []).map((s) => ({
        driverName: s.driverName,
        displayName: s.displayName,
        isPrimaryUser: s.isPrimaryUser,
        laps: s.laps.map((l) => ({
          lapNumber: l.lapNumber,
          lapTimeSeconds: l.lapTimeSeconds,
          isIncluded: l.isIncluded,
        })),
      }))
    ) ?? null;

  return {
    primaryRunId: primary.id,
    compareRunId: compareSlice?.id ?? null,
    primary: primarySlice,
    compare: compareSlice,
    lapComparison,
    setupComparison,
    setupCompareKbSnippets,
    importedDriversOnPrimary,
    fieldImportSession,
  };
}
