"use client";

/**
 * The single run detail view — extracted verbatim from `RunHistoryTable`'s private `RunDetail`
 * (2026-07-29) so the same component can render both inside Sessions and on `/runs/[id]`.
 * One component on purpose: the page and the row can never drift apart, because there is
 * only one of them. Do not fork a page-specific variant.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { ChevronRight, SquarePen, Trash2 } from "lucide-react";
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
import { ShareRunButton } from "@/components/share/ShareRunButton";
import { runIsShareable } from "@/lib/share/shareCardModel";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { InlineValueEdit } from "@/components/runs/InlineValueEdit";
import { InlineAdditiveEdit } from "@/components/runs/InlineAdditiveEdit";
import { InlinePickEdit } from "@/components/runs/InlinePickEdit";
import { RunCarMoveSheet } from "@/components/runs/RunCarMoveSheet";
import { TirePrepSheet } from "@/components/runs/TirePrepSheet";
import { lapImportHref } from "@/lib/runs/lapImportHref";
import type { SetupEditorSavedResult } from "@/components/setup/useSetupEditorSave";
import { SetupCorrectionSheet } from "@/components/runs/SetupCorrectionSheet";
import { useRunCorrections } from "@/components/runs/useRunCorrections";
import { ActionToast } from "@/components/ui/ActionToast";
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea";
// The option LIST went with the session picker (2026-08-21); the two lookups stay, because
// naming a stored session for a human is still this panel's job.
import {
  runSessionLabelOption,
  runSessionLabelOptionIdFor,
} from "@/lib/runs/runSessionLabel";
import type { RunCorrectionOptions } from "@/lib/runs/runCorrectionOptions";
import { persistedFromUiState } from "@/lib/runHandlingAssessment";
import { skyLabelFromCloudCover, skyLabelFromWeatherCode } from "@/lib/weather/conditions";

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
    /** Denormalised at save time; null on legacy rows. Names where the laps came from. */
    sourceUrl?: string | null;
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
  onEditSetup,
  cascadeFromSetupEditor,
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
  /**
   * Open the run's setup pop-up already in edit mode.
   *
   * The pop-up belongs to `RunPageClient`, not to this panel — the panel is also rendered
   * without one — so the setup door asks rather than opens. Absent, the door falls back to
   * the standalone editor page, which is still a working route.
   */
  onEditSetup?: () => void;
  /**
   * The "did your other runs have this wrong too?" questions from a correction made in that
   * pop-up, which has no page in between to hand them over through.
   *
   * The `nonce` is load-bearing: correcting the same field to the same value twice produces
   * a deep-equal payload, and the second time is exactly when a driver who answered "just
   * this run" changes their mind.
   */
  cascadeFromSetupEditor?: { nonce: number; result: SetupEditorSavedResult } | null;
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
  /*
   * Correcting a logged run happens HERE now, not only behind the pencil that
   * opens the six-step wizard. Owner-only — `allowRunMutations` is the same flag
   * that hides Edit and Share on a teammate's run, and every route re-checks it.
   */
  const corrections = useRunCorrections({
    runId: run.id,
    onChanged: () => router.refresh(),
  });
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [setupDataByRunId, setSetupDataByRunId] = useState<Record<string, unknown>>({});
  const [expandedLapStat, setExpandedLapStat] = useState<ExpandedLapStat>(null);
  /**
   * Read mode is the default, and it is the whole point.
   *
   * A session is a record you read between heats; until 2026-08-20 every value on it
   * was a live text box all the time, so the page read as a form you were standing in
   * rather than the thing you came to look at (founder call: "nothing in a session
   * should be clickable to edit until the Edit button is pressed"). Editing is now a
   * mode you enter deliberately, and leaving it puts the paper back.
   *
   * Owner-only, and it resets when the panel moves to a different run — the Sessions
   * workbench reuses this component across rows, and edit mode leaking onto the next
   * run would arm every control on a session the driver only clicked to look at.
   */
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [run.id]);
  const canEdit = allowRunMutations && editing;
  /** The car change the driver has picked but not yet confirmed. See `RunCarMoveSheet`. */
  const [pendingCarMove, setPendingCarMove] = useState<{ id: string; label: string } | null>(null);
  const [carMoveBusy, setCarMoveBusy] = useState(false);
  const [carMoveError, setCarMoveError] = useState<string | null>(null);
  /*
   * Questions handed straight across from the setup pop-up, with no page in between.
   *
   * Keyed on the nonce alone: the payload for two identical corrections is deep-equal, so
   * watching the result itself would swallow the second one.
   */
  const cascadeNonce = cascadeFromSetupEditor?.nonce ?? null;
  useEffect(() => {
    if (cascadeNonce == null || !cascadeFromSetupEditor) return;
    corrections.offerCorrections(
      cascadeFromSetupEditor.result.corrections,
      cascadeFromSetupEditor.result.suppressed
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the nonce IS the signal; see above.
  }, [cascadeNonce]);

  /** Tire prep is corrected in its own sheet, not in its stat well. See `TirePrepSheet`. */
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  useEffect(() => setPrepOpen(false), [run.id]);
  /**
   * The picker lists, fetched once on the first tap of any of them.
   *
   * Not on mount: this panel renders inside every expanded Sessions row, and a run
   * nobody is correcting should cost no request.
   */
  const [pickerOptions, setPickerOptions] = useState<RunCorrectionOptions | null>(null);
  const loadPickerOptions = useCallback(async (): Promise<RunCorrectionOptions> => {
    if (pickerOptions) return pickerOptions;
    const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/correction-options`);
    if (!res.ok) throw new Error("Couldn’t load the list");
    const payload = (await res.json()) as RunCorrectionOptions;
    setPickerOptions(payload);
    return payload;
  }, [pickerOptions, run.id]);
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
    /*
     * A run can be completed with nothing on its sheet since 2026-08-18 ("log it anyway" —
     * see NewRunForm), so an empty setup is a real, chosen state and has to say so. Without
     * this case the diff reads every field of the previous run as having been changed, which
     * is the opposite of what happened: nothing was recorded at all.
     *
     * `undefined` means the snapshot is still being fetched, which is NOT the same as empty —
     * checking it would flash "no setup" onto every run for a moment.
     */
    if (runSetupData !== undefined && Object.keys(normalizeSetupData(runSetupData)).length === 0) {
      return { mode: "no_setup" as const, rows: [] as ReturnType<typeof setupRows> };
    }
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
  const runConditions = runConditionsFromRecord(run);
  const conditionsChip = formatConditionsChip(runConditions);
  /*
   * The weather used to reach the page as a single "Cond." chip — readable, but
   * nothing you could argue with. A track temperature typed from memory the next
   * morning is one of the most commonly wrong numbers on a run, and it moves what
   * the Engineer compares this session against, so it earns its own row.
   *
   * Wind direction, cloud cover and the observation stamp stay out: those are
   * readings the app fetched, not opinions the driver holds.
   */
  /*
   * Only the readings that were actually taken. A reading nobody took is not a fact about
   * the run, and an em-dash under a heading looks like the app losing it rather than the
   * driver never having probed it (founder call, 2026-08-21).
   *
   * This is the rule Sky has always followed a few lines down; the four numeric cells were
   * the odd ones out. In practice it hides track temp, since air temp, humidity and wind
   * arrive together from the weather service and are present or absent as a set — and track
   * temp is precisely the one the service cannot supply, because a surface temperature comes
   * off an IR gun.
   */
  const conditionCells = useMemo(
    () =>
      [
        { key: "trackTempC", label: "Track temp", unit: "°C", value: runConditions.trackTempC },
        { key: "airTempC", label: "Air temp", unit: "°C", value: runConditions.airTempC },
        { key: "humidityPct", label: "Humidity", unit: "%", value: runConditions.humidityPct },
        { key: "windKph", label: "Wind", unit: "km/h", value: runConditions.windKph },
      ].filter((c) => c.value != null),
    [runConditions.trackTempC, runConditions.airTempC, runConditions.humidityPct, runConditions.windKph]
  );
  const hasAnyCondition = conditionCells.length > 0;
  /**
   * The sky, from the weather code when the service gave one and from cloud cover when
   * it did not — the same fallback the log-run form uses, so the two never disagree
   * about the same run. Null when neither was recorded, which hides the cell rather
   * than printing an em-dash for a reading that was never taken.
   */
  /**
   * The timing session feeding this run, named for a human.
   *
   * `sourceUrl` is denormalised onto each `RunImportedLapSet` at save time, so this needs
   * no extra request — but it is null on legacy rows, which is why the driver's own set is
   * preferred and the label falls back to the session name rather than assuming a URL.
   * Split runs (two imports on one run) name both, in the order they were run.
   */
  const lapImportSource = useMemo(() => {
    const sets = run.importedLapSets ?? [];
    if (sets.length === 0) return null;
    const urls: string[] = [];
    for (const s of sets) {
      const url = s.sourceUrl?.trim();
      if (url && !urls.includes(url)) urls.push(url);
    }
    if (urls.length === 0) return { label: "A timing import (no link recorded)" };
    return { label: urls.join("  ·  ") };
  }, [run.importedLapSets]);

  const skyDisplay = useMemo(() => {
    const code = run.conditionsWeatherCode;
    if (typeof code === "number" && Number.isFinite(code)) {
      return skyLabelFromWeatherCode(code).label;
    }
    const cloud = run.conditionsCloudCoverPct;
    if (typeof cloud === "number" && Number.isFinite(cloud)) return skyLabelFromCloudCover(cloud);
    return null;
  }, [run.conditionsWeatherCode, run.conditionsCloudCoverPct]);
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
  // No laps and no setup means the picture would be a title and nothing else — so no button.
  const shareable = runIsShareable(run, Boolean(run.setupSnapshot?.id));
  const shareLabel = [
    run.event?.name ?? null,
    formatRunSessionDisplay(run, { fallback: "Testing run" }),
    run.track?.name ?? run.trackNameSnapshot ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tireSetDisplay = run.tireType
    ? `${run.tireType.displayName} · run ${run.tireRunNumber}${run.tireAgeKnown === false ? " (age unknown)" : ""}`
    : "—";
  const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? null;
  const eventDisplay = run.event?.name ?? "Not part of an event";
  /*
   * The session, as one of a closed list rather than three loosely-coupled columns.
   * `meetingType` above is the free-form read-back (it prints a custom code verbatim);
   * this is which ROW of the picker the run is on, and the two can disagree — an "OTHER"
   * session reads as its own code but sits on the "Something else…" row.
   */
  const sessionLabelOptionId = runSessionLabelOptionIdFor(run);
  const sessionLabelDisplay = hasMeetingType
    ? meetingType
    : (runSessionLabelOption(sessionLabelOptionId)?.label ?? "Testing");
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
        />
        <StatWellCell
          label="Best lap"
          value={formatLap(lapDash.bestLap)}
          expandable={bestLapRows.length > 0}
          expanded={expandedLapStat === "best"}
          onToggle={() => toggleLapStat("best")}
          alignValue
        />
        <StatWellCell
          label="Avg top 5"
          value={formatLap(lapDash.avgTop5)}
          expandable={top5LapRows.length > 0}
          expanded={expandedLapStat === "avg5"}
          onToggle={() => toggleLapStat("avg5")}
          alignValue
        />
        <StatWellCell
          label="Avg top 10"
          value={formatLap(lapDash.avgTop10)}
          expandable={top10LapRows.length > 0}
          expanded={expandedLapStat === "avg10"}
          onToggle={() => toggleLapStat("avg10")}
          alignValue
        />
        <StatWellCell label="Median" value={formatLap(lapDash.median)} alignValue />
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
            {/*
              Sharing is owner-only, so it rides on `allowRunMutations` — the same flag that hides
              Edit on a peer's run in team Sessions. A teammate may read your run; publishing it
              outward under the app's branding is yours to decide. The render route enforces the
              same rule, so this is the affordance, not the guard.
            */}
            {allowRunMutations && shareable ? (
              <ShareRunButton
                compact
                runId={run.id}
                runLabel={shareLabel}
                setupSnapshotId={run.setupSnapshot?.id ?? null}
              />
            ) : null}
            {/*
              The pencil is a MODE now, not a door.
              It used to link to `/runs/[id]/edit` — the six-step logging wizard, whose
              save hard-navigates to the dashboard. So "Edit" meant "re-log this run and
              get spat out somewhere else", and fixing two digits cost nine taps and the
              scroll position on the surface where the mistake was spotted (founder call,
              2026-08-20). Nothing on the run page links to the wizard any more; the
              route survives only for uploading a video and for finishing a draft.
            */}
            {allowRunMutations ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing((v) => !v);
                }}
                aria-pressed={editing}
                aria-label={editing ? "Finish editing this run" : "Edit this run"}
                title={editing ? "Finish editing this run" : "Edit this run"}
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition",
                  editing
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted/80"
                )}
              >
                <SquarePen className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        {/*
          The mode's only banner. It exists because edit mode is otherwise invisible on a
          phone once the header scrolls away — and because "Done" has to be reachable
          without hunting for the pencil that turned it on.
        */}
        {canEdit ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary-ink/40 bg-primary/10 px-2.5 py-1.5">
            <span className="text-[11.5px] font-semibold text-primary-ink">
              Editing — tap anything underlined
            </span>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="tap-active shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground"
            >
              Done
            </button>
          </div>
        ) : null}
        {/*
          ============================== WHAT A CORRECTION MAY NOT TOUCH ==============================

          Date/time, track, session and event are all read-only, in edit mode and out of it.

          The first two never moved. The other two did until 2026-08-21, and the founder took them
          back on the ground that they are not corrections at all — they are the run's IDENTITY.
          An event re-homes the session into a different meeting, taking its track, its field and its
          place in the day with it; the session label is stamped by the timing sheet the run came off,
          so a driver retyping it is disagreeing with the transponder rather than fixing a slip.

          Everything still editable below is the driver's own answer about their own car. That is the
          line, and it is why the event picker's server-side track filter could be deleted with it
          rather than kept "just in case" — there is no longer a door for it to guard.
        */}
        <StatWellGrid cols={2} smCols={3}>
          <StatWellCell label="Date / time" value={dateTimeLabel} />
          {trackDisplay ? <StatWellCell label="Track" value={trackDisplay} /> : null}
          <StatWellCell label="Session" value={sessionLabelDisplay} />
          <StatWellCell
            label="Event"
            value={eventDisplay}
            valueClassName="whitespace-normal break-words"
          />
          <StatWellCell
            label="Car"
            value={
              canEdit ? (
                <InlinePickEdit
                  ariaLabel="Car"
                  value={carDisplay}
                  valueId={run.carId ?? null}
                  loadOptions={async () => (await loadPickerOptions()).cars}
                  // Never writes straight away — the sheet spells out what else moves.
                  confirm={async (option) => {
                    if (!option) return false;
                    setCarMoveError(null);
                    setPendingCarMove(option);
                    return false;
                  }}
                  onSave={async () => {}}
                  align="left"
                />
              ) : (
                carDisplay
              )
            }
            valueClassName="whitespace-normal break-words"
          />
          <StatWellCell
            label="Tire set"
            value={
              canEdit ? (
                <span className="inline-flex flex-col items-start gap-0.5">
                  <InlinePickEdit
                    ariaLabel="Tire set"
                    value={run.tireType?.displayName ?? "—"}
                    valueId={run.tireType?.id ?? null}
                    loadOptions={async () => (await loadPickerOptions()).tireTypes}
                    allowEmpty
                    onSave={(next) => corrections.saveFields({ tireTypeId: next })}
                    align="left"
                  />
                  {/*
                    The run number is a number, so it is typed rather than picked — and it
                    is the one field here that moves OTHER runs: correcting it shifts every
                    later run on the same set. The toast says so when it happens.
                  */}
                  <span className="text-[11px] text-muted-foreground">
                    run{" "}
                    <InlineValueEdit
                      label="Tire run number"
                      value={String(run.tireRunNumber)}
                      numeric
                      validate={(next) => {
                        const n = Number(next.trim());
                        return Number.isFinite(n) && n >= 1 ? null : "1 or more";
                      }}
                      onSave={(next) => corrections.saveFields({ tireRunNumber: Number(next) })}
                    />
                  </span>
                </span>
              ) : (
                tireSetDisplay
              )
            }
            valueClassName="whitespace-normal break-words"
          />
          <StatWellCell
            label="Additive"
            value={
              canEdit ? (
                <InlineAdditiveEdit
                  value={additiveDisplay}
                  valueId={run.additiveType?.id ?? null}
                  onSave={corrections.saveAdditive}
                />
              ) : (
                additiveDisplay
              )
            }
            valueClassName="whitespace-normal break-words"
          />
          {/*
            Tire prep is a sequence, not a value with a text box, so it cannot be an inline
            cell like the four above it. The steps stay readable here and edit mode opens
            `TirePrepSheet` over the run — which hosts the log-run form's own prep panel, so
            there is one prep control in the product rather than two that can disagree.

            This used to link into the wizard's prep step carrying a `?back=` that nothing
            read, so "Change prep" meant "re-log this run and get spat out on the dashboard"
            (founder-reported, 2026-08-21).
          */}
          <StatWellCell
            label="Tire prep"
            value={
              <span className="inline-flex flex-col items-start gap-1">
                {tirePrepSteps.length > 0 ? <TirePrepStepsList steps={tirePrepSteps} /> : "—"}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrepError(null);
                      setPrepOpen(true);
                    }}
                    className="tap-active text-[11px] font-medium text-primary-ink underline decoration-dotted underline-offset-4"
                  >
                    Change prep
                  </button>
                ) : null}
              </span>
            }
          />
        </StatWellGrid>
      </div>

      {hasAnyCondition || skyDisplay ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          {/*
            ============================== WHY CONDITIONS ARE READ-ONLY ==============================

            They were typeable until 2026-08-20, and the founder took it away on the right
            grounds: these are FETCHED. Air temp, humidity, wind and sky come from the
            weather service against the track's pin at the session time, and typing over a
            fetched number makes the record lie about where it came from — the run would
            still be stamped with a forecast it no longer agrees with.

            Track temp is the odd one out: the service cannot supply it, so it is probed or it
            is nothing. Its door is the log-run form's step-one conditions band, not a text box
            here — and since 2026-08-21 an unprobed run simply does not show the cell, so the
            surface no longer advertises a gap it has no way to fill.

            The whole block is gated on there being something to show. It used to render for
            the owner regardless, which put four em-dashes under a heading on every indoor and
            pre-feature run.
          */}
          <Eyebrow>Conditions</Eyebrow>
          <StatWellGrid cols={2} smCols={4}>
            {conditionCells.map((cell) => (
              <StatWellCell
                key={cell.key}
                label={cell.label}
                value={`${cell.value}${cell.unit}`}
              />
            ))}
            {/*
              Sky has been captured on every run since conditions existed and shown back on
              none of them — it fed the Engineer's context and nothing else. It is read-only
              like the rest, but it is now at least readable (founder call, 2026-08-20).
            */}
            {skyDisplay ? <StatWellCell label="Sky" value={skyDisplay} /> : null}
          </StatWellGrid>
        </div>
      ) : null}

      <div className="space-y-2">
        <Eyebrow>Laptimes</Eyebrow>
        {/*
          Where these laps came from, and how to change it — EDIT MODE ONLY.

          Lap times themselves are never editable: they are what the transponder saw, not
          an opinion (founder call, 2026-08-20). But the wrong heat DOES get attached, and
          nothing on the session used to say which timing session was feeding it. So the
          correction is "this is not the session I was in", not "this lap is wrong".

          It showed while merely READING the session for one day, and the founder took it
          back (2026-08-21): a URL is plumbing, not a fact about the run. Nobody looking at
          their lap times wants to know which page the app scraped — they want the laps.
          The question "is this even the right heat?" only occurs to a driver who has already
          decided something is wrong, and that driver has pressed the pencil.

          Replacing goes to the wizard's lap step, which is the real importer and already
          knows how to pick a session and say which row of the field is you — the same
          shape as the setup sheet: a separate page that comes back.

          "Comes back" is only true since 2026-08-21. The `?back=` this href has always
          carried was read by nobody, and every wizard save ran `navigateAway("/")`, so
          replacing a heat handed the driver the dashboard. `lapImportHref` builds the
          param and `/runs/[id]/edit` now honours it — see both.
        */}
        {canEdit && lapImportSource ? (
          <div className="space-y-1.5 rounded-md border border-border bg-muted/70 px-2.5 py-2">
            <Eyebrow className="mb-0">Imported from</Eyebrow>
            <p className="break-all text-[11.5px] leading-snug text-muted-foreground">
              {lapImportSource.label}
            </p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Link
                href={lapImportHref(run.id)}
                onClick={(e) => e.stopPropagation()}
                className="tap-active rounded-md border border-border bg-background px-2 py-1 text-[10.5px] font-semibold text-foreground no-underline transition-colors hover:bg-muted/80"
              >
                Replace link
              </Link>
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Remove these laps from the run?\n\nThe lap times, the field and every figure worked out from them come off. The import itself is kept in your lap history."
                    )
                  ) {
                    return;
                  }
                  void corrections.detachLapImport();
                }}
                className="tap-active rounded-md border border-destructive/35 bg-destructive/10 px-2 py-1 text-[10.5px] font-semibold text-destructive transition-colors hover:bg-destructive/20"
              >
                Remove
              </button>
            </div>
          </div>
        ) : null}
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
        <Eyebrow>{setupPreview.mode === "no_setup" ? "Setup" : "Setup vs previous run"}</Eyebrow>
        {setupPreview.mode === "no_setup" ? (
          <p className="text-muted-foreground text-xs">
            No setup recorded for this run — it was logged without one.
          </p>
        ) : (
          /*
            ============================== WHY THIS COLUMN IS NO LONGER TYPEABLE ==============================

            The NOW column was a text box until 2026-08-20, and beneath it sat "Fix another
            setup value…" — a searchable list of every value on the run, each one retypable.
            Both are gone, and the founder's reason is better than the one they were built on:
            a setup is filled on the driver's own sheet, so it should be CORRECTED on the
            driver's own sheet. One place, one control, one shape.

            The list's original argument survives the change intact rather than being
            overruled — it existed because a diff only lists what MOVED, and the value most
            often wrong is one that has not moved in weeks. The sheet answers that better
            than the list did: it shows every box on the paper, including the ones no diff
            would ever surface, with the real control for screw patterns and multi-picks
            that a text box could only corrupt.
          */
          <SetupChangedSincePreviousList
            rows={setupPreview.mode === "no_baseline" ? null : setupPreview.rows}
            runId={run.id}
          />
        )}
        {/*
          The door. `?run=` is what tells the editor it is correcting THIS run rather than
          forking a new setup off it, and `?back=` is what brings the driver home — without
          it the editor's save landed on a second copy of itself holding a setup id nobody
          had seen (fixed 2026-08-20). Both are load-bearing; neither is decoration.
        */}
        {canEdit && run.carId && run.setupSnapshot?.id ? (
          <SetupSheetDoor
            carName={run.car?.name ?? null}
            /*
             * A button when the host has a setup pop-up to open (the run page and the Sessions
             * workbench, both via `RunPageClient`), a Link to the standalone editor when it
             * does not. The pop-up is the same sheet with the same boxes, so the door reads
             * the same either way — only the trip differs.
             */
            onOpen={onEditSetup}
            href={`/cars/${encodeURIComponent(run.carId)}/setups/${encodeURIComponent(run.setupSnapshot.id)}/edit?run=${encodeURIComponent(run.id)}&back=${encodeURIComponent(`/runs/${run.id}`)}`}
          />
        ) : null}
      </div>

      {/*
        ============================== WHAT YOU THOUGHT OF THE RUN ==============================

        All three of these are the driver's own answer about their own run, so all three
        are editable in place (founder call, 2026-08-20). That decision is what let the
        wizard link come off this page entirely: with notes, the rating and the handling
        assessment fixable here, and setup on the sheet, there is nothing left that only
        the six-step form can change.

        The controls are the SAME ones used when logging — `CarHandlingRatingQuickPick`
        and `HandlingAssessmentFields` already took `readOnly`, so edit mode simply stops
        passing it. The driver answered by placing a dot on a lane and raising a
        staircase; correcting it should not mean answering a different question.
      */}
      <div className="space-y-2">
        {canEdit ? (
          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
            <Eyebrow>Notes</Eyebrow>
            <AutoGrowTextarea
              minRows={2}
              defaultValue={runNotesOnly(run)}
              aria-label="Run notes"
              placeholder="What happened out there?"
              /* Commit on blur, like every other inline correction — no save button to
                 hunt for, and nothing lost by tapping away. */
              onBlur={(e) => {
                const next = e.currentTarget.value.trim();
                if (next === runNotesOnly(run)) return;
                void corrections.saveFields({ notes: next });
              }}
              className="w-full rounded-md border border-ring/40 bg-background px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-ring"
            />
          </div>
        ) : (
          <DetailRow
            label="Notes"
            value={runNotesOnly(run) || "—"}
            multiline
            emptyAsDash
            prose
          />
        )}
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          <CarHandlingRatingQuickPick
            value={carRatingDisplay}
            readOnly={!canEdit}
            onChange={(next) => void corrections.saveFields({ carRating: next })}
          />
        </div>
        {showHandlingReadback || canEdit ? (
          <div onClick={(e) => e.stopPropagation()}>
            <HandlingAssessmentFields
              value={handlingUi}
              readOnly={!canEdit}
              onChange={(next) =>
                void corrections.saveFields({ handlingAssessmentJson: persistedFromUiState(next) })
              }
            />
          </div>
        ) : null}
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

      {/*
        Delete lives inside edit mode now. It sat permanently on the page before, which
        put the one irreversible control on a surface whose whole job is reading — and
        next to nothing else that did anything.
      */}
      {canEdit || deleteError ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
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
   * Both portal to `<body>`, so where they sit in the tree doesn't matter — but
   * they have to be in BOTH returns below, or the workbench's split layout would
   * silently lose the question and the undo.
   */
  const overlays = allowRunMutations ? (
    <>
      <RunCarMoveSheet
        open={pendingCarMove != null}
        fromCarName={carDisplay}
        toCarName={pendingCarMove?.label ?? ""}
        hasSetup={Boolean(run.setupSnapshot?.id)}
        busy={carMoveBusy}
        error={carMoveError}
        onCancel={() => {
          setPendingCarMove(null);
          setCarMoveError(null);
        }}
        onConfirm={() => {
          const target = pendingCarMove;
          if (!target || carMoveBusy) return;
          setCarMoveBusy(true);
          setCarMoveError(null);
          void corrections
            .saveFields({ carId: target.id })
            .then(() => setPendingCarMove(null))
            .catch((err: unknown) =>
              setCarMoveError(err instanceof Error ? err.message : "Could not move that run")
            )
            .finally(() => setCarMoveBusy(false));
        }}
      />
      <TirePrepSheet
        open={prepOpen}
        initialSteps={tirePrepSteps}
        initialAdditiveTypeId={run.additiveType?.id ?? ""}
        busy={prepBusy}
        error={prepError}
        onCancel={() => {
          if (prepBusy) return;
          setPrepOpen(false);
          setPrepError(null);
        }}
        onSave={({ tirePrep, additiveTypeId }) => {
          if (prepBusy) return;
          setPrepBusy(true);
          setPrepError(null);
          /*
           * One PATCH for both. The additive is stamped into the setup snapshot server-side
           * as well as onto the run, so sending it separately would write the sheet twice.
           * `additiveTypeId: ""` is how the route is told to CLEAR it — see the route's
           * "`undefined` = the body did not mention the additive" note.
           */
          void corrections
            .saveFields({ tirePrep, additiveTypeId: additiveTypeId || null })
            .then(() => setPrepOpen(false))
            .catch((err: unknown) =>
              setPrepError(err instanceof Error ? err.message : "Could not save that prep")
            )
            .finally(() => setPrepBusy(false));
        }}
      />
      <SetupCorrectionSheet
        correction={corrections.pendingCorrection}
        displayTimeZone={displayTimeZone}
        onClose={corrections.dismissCorrection}
        onApply={corrections.applyCorrection}
      />
      <ActionToast
        message={corrections.toast?.message ?? null}
        action={
          corrections.toast?.undo
            ? { label: "Undo", onClick: corrections.toast.undo }
            : null
        }
        onDismiss={corrections.dismissToast}
      />
    </>
  ) : null;

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
        {overlays}
      </>
    );
  }

  return (
    <>
      <CardPanel className={className} contentClassName={CONTENT} dataTour="run-detail">
        {record}
        {log}
      </CardPanel>
      {overlays}
    </>
  );
}

/**
 * The way into correcting this run's setup.
 *
 * One face, two mechanisms. `onOpen` raises the run page's setup pop-up, which since
 * 2026-08-21 edits in place — the founder's call, and a fair one: reading the sheet and
 * correcting it were the same picture behind two different page loads. Without a pop-up to
 * raise (a host that renders this panel bare) the old standalone editor is still there,
 * still carrying `?run=` and `?back=`.
 *
 * The sub-line differs because the promise differs. "Comes back here" is only worth saying
 * about a trip that leaves.
 */
function SetupSheetDoor({
  carName,
  onOpen,
  href,
}: {
  carName: string | null;
  onOpen?: () => void;
  href: string;
}) {
  const face = "tap-active flex w-full max-w-[30rem] items-center justify-between gap-3 rounded-lg border border-primary-ink/50 bg-primary/10 px-3 py-2 text-left no-underline transition-colors hover:bg-primary/20";
  const body = (
    <>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-foreground">
          Edit setup on the sheet
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          Every box on {carName ?? "this car"}’s sheet
          {onOpen ? "" : " · comes back here"}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        className={face}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={face}>
      {body}
    </Link>
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
