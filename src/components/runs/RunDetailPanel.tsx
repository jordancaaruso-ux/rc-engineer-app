"use client";

/**
 * The single run detail view — extracted verbatim from `RunHistoryTable`'s private `RunDetail`
 * (2026-07-29) so the same component can render both inside Sessions and on `/runs/[id]`.
 * One component on purpose: the page and the row can never drift apart, because there is
 * only one of them. Do not fork a page-specific variant.
 */

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Collapse } from "@/components/ui/Collapse";
import { formatRunDateTime } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatLap, formatStintTime, normalizeLapTimes } from "@/lib/runLaps";
import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { SetupChangedSincePreviousList } from "@/components/runs/SetupChangedSincePreviousList";
import {
  CORNER_SPEED_LABELS,
  HANDLING_TRAIT_AXIS_UI,
  formatHandlingTraitAxisForEngineer,
  parseHandlingAssessmentJson,
  uiStateFromParsed,
  type CornerSpeed,
  type HandlingTraitAxisKey,
} from "@/lib/runHandlingAssessment";
import { formatConditionsChip } from "@/lib/weather/conditions";
import { runConditionsFromRecord } from "@/lib/weather/runConditionsRecord";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { TirePrepStepsList, resolveTirePrepSteps } from "@/components/runs/TirePrepStepsList";
import {
  computeMistakeLaps,
  formatMistakeAnalysisSummary,
  formatMistakeLapDetail,
  formatLapRowBreakdown,
  getFastestIncludedLaps,
  getIncludedLaps,
  formatConsistencyScorePercent,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { LapTimeGraph } from "@/components/runs/LapTimeGraph";
import { RunRaceFieldSwitcher, RACE_IDENTITY } from "@/components/runs/RunRaceFieldSwitcher";
import Link from "next/link";
import { SquarePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTodayDraftRunOptional } from "@/components/layout/TodayDraftRunProvider";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { StatWellGrid, StatWellCell } from "@/components/runs/LapStatStrip";
import dynamic from "next/dynamic";
import { CarHandlingRatingQuickPick } from "@/components/runs/CarHandlingRatingQuickPick";
import {
  HandlingAssessmentFields,
  hasRenderableHandlingReadback,
} from "@/components/runs/HandlingAssessmentFields";
import { RUN_HISTORY_DATA_CLASS } from "@/components/runs/runHistoryTableColumns";

const LapComparePanel = dynamic(
  () =>
    import("@/components/videoAnalysis/LapComparePanel").then((m) => ({
      default: m.LapComparePanel,
    })),
  { loading: () => null }
);

/** Row shape shared by the Sessions table and `/runs/[id]` (SSR-selected). */
export type Run = {
  id: string;
  /** Present on SSR lists; used for team Sessions attribution. */
  userId?: string | null;
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  /** First save with logging complete; see resolveRunDisplayInstant. */
  loggingCompletedAt?: Date | string | null;
  /**
   * Stable ordering axis. Stamped once on create; only changes when the user
   * explicitly drags a run to a new position in this table. Reading it here
   * lets the component compute drop-target neighbours without a round-trip.
   */
  sortAt?: Date | string | null;
  /** False until user marks "Run completed" when saving. */
  loggingComplete?: boolean;
  /** Set once the driver silences the Sessions-row "no lap times" warning. */
  lapImportPromptDismissedAt?: Date | string | null;
  carId: string | null;
  eventId: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  lapTimes: unknown;
  /**
   * Materialized lap summary columns (written at save time). List rows prefer
   * these; when null (legacy rows written before the columns existed) the
   * table falls back to computing from `lapTimes` / `lapSession`.
   */
  bestLapSeconds?: number | null;
  avgTop5LapSeconds?: number | null;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  handlingAssessmentJson?: unknown;
  carRating?: number | null;
  conditionsAirTempC?: number | null;
  conditionsTrackTempC?: number | null;
  conditionsCloudCoverPct?: number | null;
  conditionsWeatherCode?: number | null;
  conditionsHumidityPct?: number | null;
  conditionsWindKph?: number | null;
  car?: { id: string; name: string; setupSheetTemplate?: string | null } | null;
  track?: { id: string; name: string } | null;
  tireType?: { id: string; displayName: string } | null;
  tireStintId?: string | null;
  tireAgeKnown?: boolean | null;
  additiveType?: { id: string; displayName: string } | null;
  warmerTimingMinutes?: number | null;
  tirePrep?: unknown;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data?: unknown } | null;
  lapSession?: unknown;
  importedLapSets?: Array<{
    id: string;
    createdAt: Date | string;
    sessionCompletedAt?: Date | string | null;
    driverId?: string | null;
    driverName: string;
    displayName?: string | null;
    normalizedName: string;
    isPrimaryUser: boolean;
    /** Omitted on Sessions list SSR; loaded on demand for lap column compare. */
    laps?: Array<{
      lapNumber: number;
      lapTimeSeconds: number;
      isIncluded?: boolean;
    }>;
  }>;
};

type ExpandedLapStat = "best" | "avg5" | "avg10" | "mistakes" | null;

function setupRows(data: unknown): { label: string; value: string }[] {
  const obj = normalizeSetupData(data);
  const seen = new Set<string>();
  const rows: { label: string; value: string }[] = [];
  for (const f of DEFAULT_SETUP_FIELDS) {
    if (f.key in obj && obj[f.key] != null && String(obj[f.key]).trim() !== "") {
      rows.push({ label: f.label + (f.unit ? ` (${f.unit})` : ""), value: String(obj[f.key]) });
      seen.add(f.key);
    }
  }
  for (const key of Object.keys(obj).sort()) {
    if (seen.has(key)) continue;
    const v = obj[key];
    if (v == null || String(v).trim() === "") continue;
    rows.push({ label: key.replace(/_/g, " "), value: String(v) });
  }
  return rows;
}

function runNotesOnly(run: Pick<Run, "notes" | "driverNotes">): string {
  return run.notes?.trim() || run.driverNotes?.trim() || "";
}

/**
 * Text fallback for the stored fields the read-back controls cannot draw. Everything the
 * driver answered through a control is now shown as that control (`HandlingAssessmentFields`
 * in `readOnly`); this is only what has no control to sit in, so nothing quietly vanishes
 * from an older session:
 *
 *   - `handlingProblems` — free text, from before the structured capture existed.
 *   - `feelGeneral` — axis retired from capture 2026-07-08, no tile.
 *   - per-trait speed tags — retired from capture 2026-08-03; the trait keeps its tile,
 *     but the slow/fast answer has nowhere to render.
 *
 * "Feel vs last run" stays out (cc935b9): the question was retired, and completion seeded a
 * neutral 0 on a car's first run, so a stored value is not necessarily something the driver
 * said. Untouched in storage, and it still reaches the Engineer.
 */
function legacyHandlingLines(
  run: Pick<Run, "handlingProblems" | "handlingAssessmentJson">
): string[] {
  const lines: string[] = [];
  const freeText = run.handlingProblems?.trim();
  if (freeText) lines.push(freeText);

  const parsed = parseHandlingAssessmentJson(run.handlingAssessmentJson);
  if (!parsed) return lines;

  if (parsed.feelGeneral != null) {
    lines.push(formatHandlingTraitAxisForEngineer("feelGeneral", parsed.feelGeneral));
  }
  for (const [key, speed] of Object.entries(parsed.speedTags ?? {})) {
    if (!key.startsWith("trait:")) continue;
    const axis = key.slice("trait:".length) as HandlingTraitAxisKey;
    const meta = HANDLING_TRAIT_AXIS_UI[axis];
    if (!meta) continue;
    const where =
      speed === "both"
        ? "in slow and fast corners"
        : `in ${CORNER_SPEED_LABELS[speed as CornerSpeed]}`;
    lines.push(`${meta.title} — ${where}`);
  }
  return lines;
}

export function RunDetailPanel({
  run,
  pickerRuns,
  runListSource,
  displayTimeZone,
  allowRunMutations = true,
  onDeleted,
  className,
  headerLead,
  headerActions,
  layout = "single",
  columnClassName,
}: {
  run: Run;
  pickerRuns: CompareRunShape[];
  runListSource: RunCompareListSource;
  displayTimeZone?: string | null;
  /** False for another member's run on team Sessions (read-only). */
  allowRunMutations?: boolean;
  /**
   * Where deleting this run should land. Sessions omits it (refresh in place);
   * `/runs/[id]` navigates away — the page it was on no longer exists.
   */
  onDeleted?: () => void;
  /** Outer card override — `/runs/[id]` squares the top corners to fuse with its action strip. */
  className?: string;
  /**
   * Slots on the "Session details" row, which is the card's header line. The
   * Sessions workbench hangs the run's controls here instead of stacking a strip
   * above the card: in a two-pane layout that strip is a band of dead height
   * between the filter bar and the first real content, and it pushes the detail
   * card out of alignment with the session rail beside it.
   */
  headerLead?: ReactNode;
  headerActions?: ReactNode;
  /**
   * `"split"` emits the record and the log as two sibling cards instead of one —
   * for the Sessions workbench's three-track grid. Everything else keeps them in
   * one card, in the same order, so the phone and `/runs/[id]` are unchanged.
   */
  layout?: "single" | "split";
  /** Applied to *both* cards in split mode — the per-column scroll box. */
  columnClassName?: string;
}) {
  const router = useRouter();
  const todayDraft = useTodayDraftRunOptional();
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [setupDataByRunId, setSetupDataByRunId] = useState<Record<string, unknown>>({});
  const [expandedLapStat, setExpandedLapStat] = useState<ExpandedLapStat>(null);
  // Holds the detail text through its collapse animation (the live value goes
  // null the instant a chip closes, which would otherwise pop the height to 0).
  const [lastLapStatDetail, setLastLapStatDetail] = useState<string | null>(null);

  useEffect(() => {
    setExpandedLapStat(null);
  }, [run.id]);

  useEffect(() => {
    setSetupDataByRunId({});
  }, [run.id]);

  async function handleDeleteRun() {
    if (deleting) return;
    const when = formatRunDateTime(resolveRunDisplayInstant(run), displayTimeZone);
    const carLabel = run.car?.name ?? run.carNameSnapshot ?? "this run";
    const ok = window.confirm(
      `Delete ${carLabel} run from ${when}?\n\nThis removes the run and its lap data. Setup snapshots are kept.`
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Delete failed (${res.status})`);
      }
      // If we just deleted today's draft, the persistent Log-run FAB and the
      // dashboard Start-run CTA read the draft from TodayDraftRunProvider's own
      // fetched state — which `router.refresh()` (server components only) does
      // not touch. Without this the FAB keeps its flag+green-dot and both point
      // at the now-deleted run's edit page (a dead 404). Re-fetch so the draft
      // indicator clears instantly.
      todayDraft?.refreshDraft();
      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete run");
      setDeleting(false);
    }
  }

  /** Compare / load-setup pickers only offer runs for this vehicle. */
  const pickerRunsSameCar = useMemo(() => {
    if (!run.carId) return pickerRuns;
    return pickerRuns.filter((r) => r.car?.id === run.carId);
  }, [pickerRuns, run.carId]);
  const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
  const laps = normalizeLapTimes(run.lapTimes);
  const meetingType =
    run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE"
      ? run.meetingSessionType === "OTHER" && run.meetingSessionCode?.trim()
        ? run.meetingSessionCode.trim()
        : run.meetingSessionType
          ? {
              PRACTICE: "Practice",
              SEEDING: "Seeding",
              QUALIFYING: "Qualifying",
              RACE: "Race",
              OTHER: "Other",
            }[run.meetingSessionType] ?? run.meetingSessionType
          : "—"
      : "—";
  const hasMeetingType = meetingType !== "—";
  const previousRunOnCar = useMemo(() => {
    if (!run.carId) return null;
    const idx = pickerRunsSameCar.findIndex((r) => r.id === run.id);
    if (idx < 0 || idx >= pickerRunsSameCar.length - 1) return null;
    return pickerRunsSameCar[idx + 1] ?? null;
  }, [pickerRunsSameCar, run.id, run.carId]);

  useEffect(() => {
    const fetchIds: string[] = [];
    if (run.setupSnapshot?.id && run.setupSnapshot.data === undefined) fetchIds.push(run.id);
    if (
      previousRunOnCar?.setupSnapshot?.id &&
      previousRunOnCar.setupSnapshot.data === undefined
    ) {
      fetchIds.push(previousRunOnCar.id);
    }
    if (fetchIds.length === 0) return;
    let alive = true;
    for (const id of fetchIds) {
      void fetch(`/api/runs/${encodeURIComponent(id)}/setup-snapshot`)
        .then((res) => res.json())
        .then((payload: { setupSnapshot?: { data?: unknown } }) => {
          if (!alive) return;
          setSetupDataByRunId((prev) => ({
            ...prev,
            [id]: payload.setupSnapshot?.data ?? {},
          }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [
    run.id,
    run.setupSnapshot?.id,
    run.setupSnapshot?.data,
    previousRunOnCar?.id,
    previousRunOnCar?.setupSnapshot?.id,
    previousRunOnCar?.setupSnapshot?.data,
  ]);

  const runSetupData = setupDataByRunId[run.id] ?? run.setupSnapshot?.data;
  const prevSetupData =
    previousRunOnCar != null
      ? setupDataByRunId[previousRunOnCar.id] ?? previousRunOnCar.setupSnapshot?.data
      : undefined;

  const setupPreview = useMemo(() => {
    if (!run.carId || prevSetupData == null) {
      return { mode: "no_baseline" as const, rows: [] as ReturnType<typeof setupRows> };
    }
    const changed = setupChangedRowsSincePrevious(runSetupData, prevSetupData);
    return { mode: "diff" as const, rows: changed };
  }, [run.carId, runSetupData, prevSetupData]);
  const ownRows = primaryLapRowsFromRun(run);
  const lapDash = getIncludedLapDashboardMetrics(ownRows);
  const mistakeAnalysis = useMemo(() => computeMistakeLaps(ownRows), [ownRows]);
  const mistakeLapNumbers = useMemo(
    () => new Set(mistakeAnalysis.mistakes.map((m) => m.lapNumber)),
    [mistakeAnalysis.mistakes]
  );
  const mistakeSummary = formatMistakeAnalysisSummary(mistakeAnalysis);
  const bestLapRows = useMemo(() => getFastestIncludedLaps(ownRows, 1), [ownRows]);
  const top5LapRows = useMemo(() => getFastestIncludedLaps(ownRows, 5), [ownRows]);
  const top10LapRows = useMemo(() => getFastestIncludedLaps(ownRows, 10), [ownRows]);
  const bestLapNumbers = useMemo(() => {
    if (lapDash.bestLap == null) return new Set<number>();
    const eps = 0.0005;
    return new Set(
      getIncludedLaps(ownRows)
        .filter((l) => Math.abs(l.lapTimeSeconds - lapDash.bestLap!) <= eps)
        .map((l) => l.lapNumber)
    );
  }, [ownRows, lapDash.bestLap]);

  // Lap rows for the All laps grid + graph — prefer full rows (carry excluded
  // flags); fall back to bare times when the lap session predates them.
  const lapDisplayRows = useMemo(
    () =>
      ownRows.length === laps.length
        ? ownRows
        : laps.map((t, i) => ({
            lapNumber: i + 1,
            lapTimeSeconds: t,
            isIncluded: true,
          })),
    [ownRows, laps]
  );
  const mistakeDetailByLapNumber = useMemo(
    () =>
      new Map(
        mistakeAnalysis.mistakes.map((m) => [m.lapNumber, formatMistakeLapDetail(m)])
      ),
    [mistakeAnalysis.mistakes]
  );

  function toggleLapStat(key: ExpandedLapStat) {
    setExpandedLapStat((cur) => (cur === key ? null : key));
  }

  const expandedLapStatDetail = useMemo(() => {
    switch (expandedLapStat) {
      case "best":
        return formatLapRowBreakdown(bestLapRows);
      case "avg5":
        return top5LapRows.length > 0
          ? `${formatLapRowBreakdown(top5LapRows)} → avg ${formatLap(lapDash.avgTop5)}`
          : "—";
      case "avg10":
        return top10LapRows.length > 0
          ? `${formatLapRowBreakdown(top10LapRows)} → avg ${formatLap(lapDash.avgTop10)}`
          : "—";
      case "mistakes":
        return mistakeSummary;
      default:
        return null;
    }
  }, [
    expandedLapStat,
    bestLapRows,
    top5LapRows,
    top10LapRows,
    lapDash.avgTop5,
    lapDash.avgTop10,
    mistakeSummary,
  ]);
  useEffect(() => {
    if (expandedLapStatDetail !== null) setLastLapStatDetail(expandedLapStatDetail);
  }, [expandedLapStatDetail]);
  const conditionsChip = formatConditionsChip(runConditionsFromRecord(run));
  const carRatingDisplay = useMemo(() => {
    const rating = run.carRating;
    if (typeof rating === "number" && Number.isFinite(rating) && rating >= 1 && rating <= 10) {
      return Math.round(rating);
    }
    return null;
  }, [run.carRating]);
  /* The driver placed a dot on a lane and raised a staircase; the session shows them back
     the lane and the staircase, not a paragraph describing what they did. */
  const handlingUi = useMemo(
    () => uiStateFromParsed(parseHandlingAssessmentJson(run.handlingAssessmentJson)),
    [run.handlingAssessmentJson]
  );
  const showHandlingReadback = hasRenderableHandlingReadback(handlingUi);
  const legacyHandlingText = useMemo(
    () =>
      legacyHandlingLines({
        handlingProblems: run.handlingProblems,
        handlingAssessmentJson: run.handlingAssessmentJson,
      })
        .join("\n")
        .trim(),
    [run.handlingProblems, run.handlingAssessmentJson]
  );

  const runInstant = resolveRunDisplayInstant(run);
  const dateTimeLabel = formatRunDateTime(runInstant, displayTimeZone);
  const tireSetDisplay = run.tireType
    ? `${run.tireType.displayName} · run ${run.tireRunNumber}${run.tireAgeKnown === false ? " (age unknown)" : ""}`
    : "—";
  // Additive well = the product; Tire prep well = the application sequence.
  // Compound toggles (ST205, ABH, AT15, …) are setup-sheet parameters, not tire
  // prep — they live on the setup sheet and are intentionally excluded here.
  const additiveDisplay = run.additiveType?.displayName ?? "—";
  const tirePrepSteps = resolveTirePrepSteps(run);

  // Lap stats / grid / graph split into three nodes so the driver-compare
  // switcher can slot its notebook tabs between the stats and the lap card.
  // Solo runs reassemble them into the original side-by-side `userView`.
  const lapStatsBlock = (
    <div className="space-y-1">
      <StatWellGrid>
        <StatWellCell label="Laps" value={String(lapDash.lapCount)} alignValue />
        <StatWellCell
          label="Stint"
          title="Sum of included lap times"
          value={lapDash.stintSeconds != null ? formatStintTime(lapDash.stintSeconds) : "—"}
          alignValue
          mono
        />
        <StatWellCell
          label="Best lap"
          value={formatLap(lapDash.bestLap)}
          expandable={bestLapRows.length > 0}
          expanded={expandedLapStat === "best"}
          onToggle={() => toggleLapStat("best")}
          alignValue
          mono
        />
        <StatWellCell
          label="Avg top 5"
          value={formatLap(lapDash.avgTop5)}
          expandable={top5LapRows.length > 0}
          expanded={expandedLapStat === "avg5"}
          onToggle={() => toggleLapStat("avg5")}
          alignValue
          mono
        />
        <StatWellCell
          label="Avg top 10"
          value={formatLap(lapDash.avgTop10)}
          expandable={top10LapRows.length > 0}
          expanded={expandedLapStat === "avg10"}
          onToggle={() => toggleLapStat("avg10")}
          alignValue
          mono
        />
        <StatWellCell label="Median" value={formatLap(lapDash.median)} alignValue mono />
        {conditionsChip ? (
          <StatWellCell
            label="Cond."
            value={conditionsChip.value}
            title={conditionsChip.title}
            alignValue
          />
        ) : null}
        <StatWellCell
          label="Consist."
          title="Consistency: 100 − CV; higher = more consistent laps"
          value={
            lapDash.consistencyScore != null
              ? formatConsistencyScorePercent(lapDash.consistencyScore)
              : "—"
          }
          alignValue
          mono
        />
        <StatWellCell
          label="Mistakes"
          title={mistakeSummary}
          value={mistakeAnalysis.eligible ? String(mistakeAnalysis.mistakeCount) : "—"}
          expandable={mistakeAnalysis.eligible}
          expanded={expandedLapStat === "mistakes"}
          onToggle={() => toggleLapStat("mistakes")}
          alignValue
        />
      </StatWellGrid>
      <Collapse open={Boolean(expandedLapStat && expandedLapStatDetail)}>
        <p
          className={cn(
            RUN_HISTORY_DATA_CLASS,
            "pt-1 text-muted-foreground leading-snug break-words",
          )}
        >
          {expandedLapStatDetail ?? lastLapStatDetail}
        </p>
      </Collapse>
    </div>
  );

  const lapCardBlock =
    laps.length > 0 ? (
      <div className={cn("flex flex-wrap gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", RUN_HISTORY_DATA_CLASS)}>
        {lapDisplayRows.map((r, i) => {
          const isMistake = mistakeLapNumbers.has(r.lapNumber);
          const isBest = bestLapNumbers.has(r.lapNumber);
          const isHighlighted = isMistake || isBest;
          const mistake = mistakeAnalysis.mistakes.find((m) => m.lapNumber === r.lapNumber);
          return (
            <span
              key={i}
              className={cn(
                "inline-grid grid-cols-[2rem_auto] gap-x-0.5 items-baseline tabular-nums rounded px-0.5",
                !r.isIncluded && "opacity-50 line-through",
                isMistake && "lap-flag-mistake text-white ring-1 ring-red-500/45",
                isBest && !isMistake && "lap-flag-best text-white ring-1 ring-purple-500/45"
              )}
              title={
                !r.isIncluded
                  ? "Excluded"
                  : isMistake && mistake
                    ? `${formatMistakeLapDetail(mistake)} vs median`
                    : isBest
                      ? "Best lap"
                      : undefined
              }
            >
              <span
                className={cn(
                  "text-right",
                  isHighlighted ? "text-white/80" : "text-muted-foreground"
                )}
              >
                {r.lapNumber}.
              </span>
              <span>{r.lapTimeSeconds.toFixed(3)}s</span>
            </span>
          );
        })}
      </div>
    ) : (
      <div className={cn(RUN_HISTORY_DATA_CLASS, "text-muted-foreground")}>—</div>
    );

  const buildLapGraph = (lineColor?: string) =>
    lapDisplayRows.length >= 3 ? (
      <div className="space-y-1">
        <LapTimeGraph
          rows={lapDisplayRows}
          bestLapNumbers={bestLapNumbers}
          mistakeLapNumbers={mistakeLapNumbers}
          mistakeDetailByLapNumber={mistakeDetailByLapNumber}
          medianSeconds={null}
          lineColor={lineColor}
        />
      </div>
    ) : null;

  /**
   * What the car did — the performance record. Session identity, the lap stats,
   * every lap, the trace. This is the half you stare at between runs, and the
   * half that wants width and height.
   */
  const record = (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {headerLead}
            <Eyebrow className="mb-0">Session details</Eyebrow>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            {allowRunMutations ? (
              <Link
                href={`/runs/${encodeURIComponent(run.id)}/edit`}
                aria-label="Edit run"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground no-underline hover:bg-muted/80 transition"
                title="Edit run"
                onClick={(e) => e.stopPropagation()}
              >
                <SquarePen className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
        <StatWellGrid cols={2} smCols={3}>
          <StatWellCell label="Date / time" value={dateTimeLabel} />
          {hasMeetingType ? <StatWellCell label="Session" value={meetingType} /> : null}
          <StatWellCell label="Car" value={carDisplay} valueClassName="whitespace-normal break-words" />
          <StatWellCell label="Tire set" value={tireSetDisplay} valueClassName="whitespace-normal break-words" />
          <StatWellCell label="Additive" value={additiveDisplay} valueClassName="whitespace-normal break-words" />
          <StatWellCell
            label="Tire prep"
            value={
              tirePrepSteps.length > 0 ? (
                <TirePrepStepsList steps={tirePrepSteps} />
              ) : (
                "—"
              )
            }
          />
        </StatWellGrid>
      </div>

      <div className="space-y-2">
        <Eyebrow>Laptimes</Eyebrow>
        <RunRaceFieldSwitcher
          runId={run.id}
          enabled={(run.importedLapSets?.length ?? 0) > 0}
          userLapRows={lapDisplayRows}
          userStats={lapStatsBlock}
          userLapCard={lapCardBlock}
          userGraph={buildLapGraph(RACE_IDENTITY.you)}
          userView={
            <div className="space-y-2 min-w-0">
              {lapStatsBlock}
              {lapCardBlock}
              {buildLapGraph()}
            </div>
          }
        />
      </div>
    </>
  );

  /**
   * What *you* did, and what you thought of it. Narrow content, all of it: a
   * handful of changed parameters, a sentence or two of notes, a rating. Video
   * closes it out — it's somewhere you go, not something you read past, which is
   * why it sits at the bottom on every surface now rather than mid-record.
   */
  const log = (
    <>
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        <Eyebrow>Setup vs previous run</Eyebrow>
        <SetupChangedSincePreviousList
          rows={setupPreview.mode === "no_baseline" ? null : setupPreview.rows}
          carId={run.car?.id ?? null}
        />
      </div>

      <div className="space-y-2">
        <DetailRow
          label="Notes"
          value={runNotesOnly(run) || "—"}
          multiline
          emptyAsDash
          prose
        />
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          <CarHandlingRatingQuickPick value={carRatingDisplay} readOnly />
        </div>
        {/* No `stopPropagation` wrapper: read-only, so there is nothing to tap and clicks
            should behave like the rest of the panel. */}
        {showHandlingReadback ? <HandlingAssessmentFields value={handlingUi} readOnly /> : null}
        {legacyHandlingText ? (
          <DetailRow
            /* Alongside the controls this is the leftover; on its own (a pre-capture run)
               it is still the whole of what was recorded. */
            label={showHandlingReadback ? "Also noted" : "Handling details"}
            value={legacyHandlingText}
            multiline
            emptyAsDash
            prose
          />
        ) : null}
      </div>

      <LapComparePanel
        runId={run.id}
        trackId={run.track?.id ?? null}
        allowMutations={allowRunMutations}
      />

      {allowRunMutations || deleteError ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          {allowRunMutations ? (
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleDeleteRun}
                disabled={deleting}
                aria-label={deleting ? "Deleting run" : "Delete run"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-60 transition"
                title="Permanently delete this run"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
          {deleteError ? <p className="text-[11px] text-destructive">{deleteError}</p> : null}
        </div>
      ) : null}
    </>
  );

  const CONTENT = "space-y-3 text-sm min-w-0 w-full";

  /**
   * Two cards, emitted as siblings so the workbench grid can place them in its
   * own tracks — record in the wide middle column, log in the narrow right one.
   * Deliberately NOT a nested grid: the columns have to be the *page's* tracks or
   * they can't align with the rail or scroll independently of each other.
   */
  /*
   * `data-tour="run-detail"` goes on the card that CARRIES the record, not on a section inside
   * it: the demo walkthrough's stop 4 describes the whole thing — Session details, the lap
   * figures, the setup diff since the previous run, and the notes — and an anchor on the first
   * of those four spotlighted the header alone. Inert for everyone but the tour.
   *
   * On a phone this card is taller than the viewport; `useTourPlacement` top-aligns an
   * over-tall anchor rather than centring it, so the section headings stay on screen.
   */
  if (layout === "split") {
    return (
      <>
        <CardPanel
          className={cn(className, columnClassName)}
          contentClassName={CONTENT}
          dataTour="run-detail"
        >
          {record}
        </CardPanel>
        <CardPanel className={cn(className, columnClassName)} contentClassName={CONTENT}>
          {log}
        </CardPanel>
      </>
    );
  }

  return (
    <CardPanel className={className} contentClassName={CONTENT} dataTour="run-detail">
      {record}
      {log}
    </CardPanel>
  );
}

function DetailRow({
  label,
  value,
  multiline,
  emptyAsDash,
  prose,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  emptyAsDash?: boolean;
  /** Render the value in the UI sans (Sora) instead of the mono data class — for prose like notes. */
  prose?: boolean;
}) {
  const show = emptyAsDash && !value.trim() ? "—" : value;
  return (
    <div className="space-y-1">
      <Eyebrow>{label}</Eyebrow>
      <div
        className={cn(
          prose ? "text-[13px] leading-relaxed" : RUN_HISTORY_DATA_CLASS,
          "text-foreground",
          multiline && "whitespace-pre-wrap break-words"
        )}
      >
        {show}
      </div>
    </div>
  );
}
