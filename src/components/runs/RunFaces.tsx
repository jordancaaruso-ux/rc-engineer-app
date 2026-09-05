"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitCompare, Sparkles, SquarePen, Timer, Trash2 } from "lucide-react";
import type { Run } from "@/components/runs/RunDetailPanel";
import type { WorkbenchSetupDiff } from "@/lib/runs/sessionWorkbenchModel";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";
import type { RunCorrectionOptions } from "@/lib/runs/runCorrectionOptions";
import { SetupChangedSincePreviousList } from "@/components/runs/SetupChangedSincePreviousList";
import { LapTimeGraph, type LapGraphRow } from "@/components/runs/LapTimeGraph";
import { RunRaceFieldSwitcher, RACE_IDENTITY } from "@/components/runs/RunRaceFieldSwitcher";
import { resolveTirePrepSteps } from "@/components/runs/TirePrepStepsList";
import { InlineValueEdit } from "@/components/runs/InlineValueEdit";
import { InlinePickEdit } from "@/components/runs/InlinePickEdit";
import { RunCarMoveSheet } from "@/components/runs/RunCarMoveSheet";
import { TirePrepSheet } from "@/components/runs/TirePrepSheet";
import { SetupCorrectionSheet } from "@/components/runs/SetupCorrectionSheet";
import { useRunCorrections } from "@/components/runs/useRunCorrections";
import { CarHandlingRatingQuickPick } from "@/components/runs/CarHandlingRatingQuickPick";
import { HandlingAssessmentFields } from "@/components/runs/HandlingAssessmentFields";
import {
  SetupSheetModal,
  RunLapAnalysisModal,
  type SetupSheetModalRun,
} from "@/components/runs/RunHistoryModalsLazy";
import {
  ReadOnlySheetSurface,
  SheetSetupEditorClient,
  LibrarySetupEditorClient,
  SetupSheetView,
} from "@/components/runs/RunSetupSheetLazy";
import { ExitPromptSheet } from "@/components/ui/ExitPromptSheet";
import { registerRunSetupExitAsk } from "@/components/runs/runSetupEditGuard";
import type {
  HostedSetupSave,
  SetupEditorSavedResult,
} from "@/components/setup/useSetupEditorSave";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSaveContext } from "@/lib/setup/setupSaveContext";
import { SessionSetupSaveButton } from "@/components/setup/SessionSetupSaveButton";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { ShareRunButton } from "@/components/share/ShareRunButton";
import { RatingDial } from "@/components/ui/RatingDial";
import { ActionToast } from "@/components/ui/ActionToast";
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea";
import { runIsShareable } from "@/lib/share/shareCardModel";
import {
  computeMistakeLaps,
  fadeOverRunSeconds,
  formatConsistencyScorePercent,
  formatFadeOverRun,
  formatFadePerLap,
  getFadePerLap,
  getFadeProfile,
  getFiveMinuteStintStartingAt,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
  readFiveMinStartLap,
  type IncludedLapDashboardMetrics,
} from "@/lib/lapAnalysis";
import {
  CAPTURE_TRAIT_AXIS_KEYS,
  HANDLING_SEVERITY_CHIP_LABELS,
  HANDLING_TRAIT_CHIP_META,
  formatPhaseBalanceWord,
  parseHandlingAssessmentJson,
  persistedFromUiState,
  uiStateFromParsed,
} from "@/lib/runHandlingAssessment";
import { formatFiveMinuteStint, formatLap, formatStintTime } from "@/lib/runLaps";
import { formatRunDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { runConditionsFromRecord } from "@/lib/weather/runConditionsRecord";
import { skyLabelFromCloudCover, skyLabelFromWeatherCode } from "@/lib/weather/conditions";
import { formatTirePrepLine } from "@/lib/runs/tirePrep";
import { lapImportHref } from "@/lib/runs/lapImportHref";
import { cn } from "@/lib/utils";

/**
 * A whole run, folded to fit where it sits (2026-08-25).
 *
 * This replaces both the three-block session expansion AND — as the surfaces move
 * over to it — the run's own page. It carries everything `RunDetailPanel` carries:
 * the lap figures and the trace, what moved on the car, the sheet, the rubber, the
 * weather, what the driver said, correcting any of it, and every door out.
 *
 * ## Why it folds into faces rather than stacking
 *
 * The point of opening a run where it sits is comparing it against the runs above
 * and below it. A stack of every block is taller than the page it replaced, so two
 * open runs push the day off screen and you are back to page-back-page-back. Faces
 * make the open row a **fixed, predictable height**: whatever the run holds, it
 * costs the same amount of the day.
 *
 * ## What never swaps
 *
 * Two pinned strips above the faces, and they are the whole idea:
 *
 * - **Pace and verdict** — best, top 5, top 10, laps, and the dashboard's own
 *   `RatingDial`. The figures you compare runs on cannot live behind a tab.
 * - **What it RAN ON** — the car and the rubber; the sauce and the prep; the whole
 *   weather. Three lines (founder call, 2026-08-25): these are exactly what differs
 *   between two runs on one afternoon, and while they lived inside a face you had to
 *   open that face on each run in turn to compare them, which is the thing opening
 *   runs in place exists to stop.
 *
 * Because the dial is pinned, the Notes face does NOT draw it again: the rating
 * would otherwise appear twice on one card.
 *
 * ## Three faces, three questions
 *
 * - **Laps** — the numbers, then the laps and the trace: how fast. The four figures
 *   lead, beside their pinned siblings, rather than sitting under a list of twenty.
 * - **Setup** — what setup MEANS and nothing else: what moved since the last run,
 *   and the sheet it moved on. (Car and Sheet were one subject split in two — the
 *   sheet IS the setup, drawn rather than listed.)
 * - **Notes** — what the driver said. Reading, that is the flagged chips and the
 *   note; in edit mode it is the capture controls themselves, so correcting a
 *   rating means answering the same question the same way it was asked.
 *
 * ## What was deleted
 *
 * A "This run" block held when / track / session / event / car. Every line of it is
 * on screen at the same moment — the time is the row's own second line, the track and
 * date are the heading of the day the row sits in, the session is the row's title,
 * the event is that heading when there is one, and the car is pinned. It was the run
 * repeating its own address.
 *
 * Editing is a MODE, not a permanent affordance (the same rule the run page has):
 * nothing is underlined until Edit is pressed, and it resets whenever the run
 * changes.
 */

type Face = "laps" | "setup" | "notes";

/** `SetupSheetView` always wants a sink, even read-only. Module-level so it is identity-stable. */
const noop = () => {};

/** Everything the Setup face needs to draw this run's paper, from one request. */
type InlineSheet = {
  /** The snapshot's data as STORED — arrays, preset objects, numbers. */
  values: SetupSnapshotData;
  /** Whether this viewer may save it, and how. Null until the server has said. */
  save: SetupSaveContext | null;
  /** Set when this car's chassis draws as a sheet. Null means the legacy field list. */
  sheetModelId: string | null;
  /** The EDITION these keys are written on, when not the primary blank. Rides with the model. */
  editionBlankId: string | null;
  /** The field list — still the surface for every chassis the app cannot draw. */
  template: SetupSheetTemplate | null;
};

const FACES: ReadonlyArray<{ id: Face; label: string }> = [
  { id: "laps", label: "Laps" },
  { id: "setup", label: "Setup" },
  { id: "notes", label: "Notes" },
];

export function RunFaces({
  run,
  setupDiff,
  displayTimeZone,
  runTimeZone,
  allowRunMutations,
  pickerRuns = [],
  runListSource = "my_runs",
  runOwnerDisplayName = null,
  openFace = null,
  onDeleted,
  className,
}: {
  run: Run;
  /** From `buildGroupRunRows`; null when the host loaded no setup snapshots. */
  setupDiff: WorkbenchSetupDiff | null;
  /**
   * The reader's zone — the last fallback only. See `runZone`: a run is printed on
   * the clock that was on the pit bench, not the one the reader is holding.
   */
  displayTimeZone: string | null;
  /**
   * The zone THIS run's clock should be read on, when the host knows better than the
   * run row does — a host that resolved the driver's account zone for legacy runs
   * (`loadAnalysisOuting`) passes it here.
   */
  runTimeZone?: string | null;
  /** Owner-only. The routes enforce it again — this is the affordance, not the guard. */
  allowRunMutations: boolean;
  /** Runs offered to the lap-compare and setup-sheet pickers. Empty is fine: both still open. */
  pickerRuns?: CompareRunShape[];
  runListSource?: RunCompareListSource;
  runOwnerDisplayName?: string | null;
  /**
   * "Open this run showing X" — the wrench on a list row, which asks for the sheet rather than for
   * the run. The nonce is what makes a repeat tap land; see the effect that reads it.
   */
  openFace?: { face: Face; nonce: number } | null;
  /** Called instead of `router.refresh()` once a delete lands (hosts that hold a list). */
  onDeleted?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [face, setFace] = useState<Face>("laps");
  const [editing, setEditing] = useState(false);
  // A different run is a different record — never inherit the previous one's mode.
  useEffect(() => {
    setEditing(false);
    setFace("laps");
  }, [run.id]);
  /*
   * A list opening this run ON a particular face — the wrench on the row, which means "show me the
   * sheet" and not merely "open this run".
   *
   * Driven by the NONCE, never by the object: the host rebuilds it on every render, and a second
   * tap on the wrench of a row already open on Laps has to land, so "same face as last time" can't
   * be the no-op test. A resting host passes nothing and nonce 0, which this ignores.
   */
  const requestedFace = openFace?.face ?? null;
  const requestedFaceNonce = openFace?.nonce ?? 0;
  useEffect(() => {
    if (requestedFaceNonce > 0 && requestedFace) setFace(requestedFace);
  }, [requestedFaceNonce, requestedFace]);
  const canEdit = allowRunMutations && editing;

  const corrections = useRunCorrections({ runId: run.id, onChanged: () => router.refresh() });

  /*
   * The clock this run is printed on: the host's answer, then the run's own zone,
   * then the reader's.
   *
   * Measured, not theorised: without this the "When" line here read **6:52 AM** while
   * the row two pixels above it read **4:48 PM** — the panel was formatting in the
   * reader's zone (UTC, server-side, with no timezone cookie) while the row was
   * formatting in the driver's. One card cannot state two clocks for one run.
   */
  const runZone = runTimeZone ?? run.localTimeZone ?? displayTimeZone;

  /* ---------------------------------------------------------------- laps -- */
  const lapRows = useMemo(() => primaryLapRowsFromRun(run), [run]);
  const dash = useMemo(() => getIncludedLapDashboardMetrics(lapRows), [lapRows]);
  // Mistakes still flag laps on the card; they left the figure row for fade (2026-08-27).
  const mistakes = useMemo(() => computeMistakeLaps(lapRows), [lapRows]);
  const mistakeLapNumbers = useMemo(
    () => new Set(mistakes.mistakes.map((m) => m.lapNumber)),
    [mistakes]
  );
  const fade = useMemo(
    () => ({ perLap: getFadePerLap(lapRows), overRunSeconds: fadeOverRunSeconds(lapRows) }),
    [lapRows]
  );
  const fadeProfile = useMemo(() => getFadeProfile(lapRows), [lapRows]);
  const emptyMistakeDetail = useMemo(() => new Map<number, string>(), []);
  const bestLapNumbers = useMemo(() => {
    if (dash.bestLap == null) return new Set<number>();
    const numbers = new Set<number>();
    for (const lap of lapRows) {
      if (lap.isIncluded !== false && Math.abs(lap.lapTimeSeconds - dash.bestLap) <= 0.0005) {
        numbers.add(lap.lapNumber);
      }
    }
    return numbers;
  }, [dash.bestLap, lapRows]);

  /* ------------------------------------------------ the 5-minute window -- */
  /*
   * The window has ONE handle — its start lap; the clock decides the rest
   * (founder ruling, 2026-09-01: per run, auto = best consecutive 5 minutes,
   * with the option to change). Tapping a lap on the card moves it; the stored
   * choice lives inside `run.lapSession` and a stale one (laps re-imported
   * since) silently falls back to auto rather than inventing a figure.
   */
  const storedFiveMinStart = useMemo(() => readFiveMinStartLap(run.lapSession), [run]);
  /** Optimistic local choice; `undefined` = trust what the server payload says. */
  const [localFiveMinStart, setLocalFiveMinStart] = useState<number | null | undefined>(undefined);
  useEffect(() => setLocalFiveMinStart(undefined), [run.id]);
  const fiveMinStart = localFiveMinStart !== undefined ? localFiveMinStart : storedFiveMinStart;
  const chosenFiveMinStint = useMemo(
    () => (fiveMinStart != null ? getFiveMinuteStintStartingAt(lapRows, fiveMinStart) : null),
    [lapRows, fiveMinStart]
  );
  /** What the card displays: the driver's window when set and valid, else the best. */
  const fiveMinStint = chosenFiveMinStint ?? dash.fiveMinStint;
  const fiveMinIsCustom =
    chosenFiveMinStint != null &&
    chosenFiveMinStint.startLapNumber !== dash.fiveMinStint?.startLapNumber;
  const fiveMinWindowLapNumbers = useMemo(() => {
    const s = new Set<number>();
    if (fiveMinStint) {
      for (const lap of lapRows) {
        if (
          lap.lapNumber >= fiveMinStint.startLapNumber &&
          lap.lapNumber <= fiveMinStint.endLapNumber
        ) {
          s.add(lap.lapNumber);
        }
      }
    }
    return s;
  }, [fiveMinStint, lapRows]);
  const saveFiveMinStart = useCallback(
    (next: number | null) => {
      const prev = fiveMinStart;
      setLocalFiveMinStart(next);
      void corrections.saveFields({ fiveMinStartLap: next }).catch(() => {
        setLocalFiveMinStart(prev);
      });
    },
    [corrections, fiveMinStart]
  );
  const pickFiveMinStart = useCallback(
    (lapNumber: number) => {
      // A lap the clock can't fund five minutes from is not a valid handle — no-op,
      // the window visibly stays put.
      if (getFiveMinuteStintStartingAt(lapRows, lapNumber) == null) return;
      saveFiveMinStart(lapNumber);
    },
    [lapRows, saveFiveMinStart]
  );
  const graphRows = useMemo(
    () =>
      lapRows.map((lap) => ({
        lapNumber: lap.lapNumber,
        lapTimeSeconds: lap.lapTimeSeconds,
        isIncluded: lap.isIncluded !== false,
      })),
    [lapRows]
  );

  /* ------------------------------------------------------------ the run -- */
  const conditions = runConditionsFromRecord(run);
  const skyDisplay = useMemo(() => {
    const code = run.conditionsWeatherCode;
    if (typeof code === "number" && Number.isFinite(code)) return skyLabelFromWeatherCode(code).label;
    const cloud = run.conditionsCloudCoverPct;
    if (typeof cloud === "number" && Number.isFinite(cloud)) return skyLabelFromCloudCover(cloud);
    return null;
  }, [run.conditionsCloudCoverPct, run.conditionsWeatherCode]);

  const carDisplay = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
  const trackDisplay = run.track?.name ?? run.trackNameSnapshot ?? null;
  const rating =
    typeof run.carRating === "number" && run.carRating >= 1 && run.carRating <= 10
      ? Math.round(run.carRating)
      : null;
  const tirePrepSteps = resolveTirePrepSteps(run);

  /*
   * The pinned weather line — the whole reading, in shortest-honest form.
   *
   * Only what was actually taken. A run with no probed track temperature simply
   * doesn't claim one; an em-dash under a heading is the surface advertising a gap
   * it has no way to fill, which is the rule the Conditions block used before this
   * line replaced it.
   */
  const weatherLine = useMemo(() => {
    const parts: string[] = [];
    if (conditions.airTempC != null) parts.push(`${Math.round(conditions.airTempC)}°C air`);
    if (conditions.trackTempC != null) parts.push(`${Math.round(conditions.trackTempC)}°C track`);
    if (conditions.humidityPct != null) parts.push(`${Math.round(conditions.humidityPct)}%`);
    if (conditions.windKph != null) parts.push(`${Math.round(conditions.windKph)} km/h`);
    if (skyDisplay) parts.push(skyDisplay.toLowerCase());
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [
    conditions.airTempC,
    conditions.humidityPct,
    conditions.trackTempC,
    conditions.windKph,
    skyDisplay,
  ]);

  /*
   * The rubber's sauce and heat, on one line: "Mighty Gripper · 10m warmers 80°C".
   * `prepSequenceLine` is the same line WITHOUT the additive, for edit mode — there
   * the additive is its own picker and would otherwise be printed twice.
   */
  const prepLine = useMemo(
    () => formatTirePrepLine(tirePrepSteps, run.additiveType?.displayName ?? null),
    [run.additiveType?.displayName, tirePrepSteps]
  );
  const prepSequenceLine = useMemo(() => formatTirePrepLine(tirePrepSteps, null), [tirePrepSteps]);

  /* ------------------------------------------------------ what was said -- */
  const feel = useMemo(() => {
    const ui = uiStateFromParsed(parseHandlingAssessmentJson(run.handlingAssessmentJson));
    const chips: string[] = [];
    if (ui.balanceEntry != null) chips.push(`Entry · ${formatPhaseBalanceWord(ui.balanceEntry)}`);
    if (ui.balanceMid != null) chips.push(`Mid · ${formatPhaseBalanceWord(ui.balanceMid)}`);
    if (ui.balanceExit != null) chips.push(`Exit · ${formatPhaseBalanceWord(ui.balanceExit)}`);
    // Only the poles the driver actually flagged — an unflagged trait is a question
    // answered "no", which is a fact for the capture control, not for a strip of chips.
    for (const axis of CAPTURE_TRAIT_AXIS_KEYS) {
      const value = ui[axis];
      if (value == null || value === 0) continue;
      for (const pole of HANDLING_TRAIT_CHIP_META[axis].problemPoles) {
        if (Math.sign(value) !== pole.sign) continue;
        const severity = Math.abs(value) as 1 | 2 | 3;
        chips.push(`${pole.label} · ${HANDLING_SEVERITY_CHIP_LABELS[severity] ?? ""}`.trim());
      }
    }
    return { chips, ui };
  }, [run.handlingAssessmentJson]);

  const note = (run.notes?.trim() || run.driverNotes?.trim() || "").trim();
  const problems = run.handlingProblems?.trim() ?? "";

  /* --------------------------------------------------------- the pickers -- */
  const [pickerOptions, setPickerOptions] = useState<RunCorrectionOptions | null>(null);
  const loadPickerOptions = useCallback(async (): Promise<RunCorrectionOptions> => {
    if (pickerOptions) return pickerOptions;
    const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/correction-options`);
    if (!res.ok) throw new Error("Couldn’t load the list");
    const payload = (await res.json()) as RunCorrectionOptions;
    setPickerOptions(payload);
    return payload;
  }, [pickerOptions, run.id]);

  const [additiveOptions, setAdditiveOptions] = useState<
    { id: string; label: string }[] | null
  >(null);
  const loadAdditiveOptions = useCallback(async () => {
    if (additiveOptions) return additiveOptions;
    const res = await fetch("/api/additive-types");
    if (!res.ok) throw new Error("Couldn’t load the list");
    const payload = (await res.json()) as {
      additiveTypes?: { id: string; displayName: string }[];
    };
    const next = (payload.additiveTypes ?? []).map((a) => ({ id: a.id, label: a.displayName }));
    setAdditiveOptions(next);
    return next;
  }, [additiveOptions]);

  /* ----------------------------------------------------------- the doors -- */
  const [sheetModal, setSheetModal] = useState<{
    run: SetupSheetModalRun;
    pickerRuns: SetupSheetModalRun[];
  } | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const openSetupSheet = useCallback(async () => {
    setSheetLoading(true);
    setSheetError(null);
    try {
      const res = await fetch(
        `/api/runs/for-setup-compare?runId=${encodeURIComponent(run.id)}`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as { runs?: SetupSheetModalRun[] };
      const rows = Array.isArray(data.runs) ? data.runs : [];
      const anchor = rows.find((r) => r.id === run.id);
      // 403 is an answer, not a failure: a teammate's run is readable only while it
      // is shared, and every row on their day carries this door.
      if (res.status === 403) throw new Error("not_shared");
      if (!res.ok || !anchor) throw new Error("load failed");
      setSheetModal({ run: anchor, pickerRuns: rows });
    } catch (error) {
      setSheetError(
        error instanceof Error && error.message === "not_shared"
          ? "That run’s setup isn’t shared with the team."
          : "Couldn’t load the setup for this run."
      );
    } finally {
      setSheetLoading(false);
    }
  }, [run.id]);

  /* --------------------------------------------- the sheet, on the face -- */
  /**
   * ============================== THE SHEET IS THE SETUP FACE ==============================
   *
   * Until 2026-08-25 the Setup face was a list of what moved and a **View setup** button, and the
   * sheet — the picture of the car as it went out — only existed inside a pop-up. That was one tap
   * too many for the thing the face is named after, and it split one subject across two surfaces:
   * the list said "camber 3.0 → 3.5" and the paper it moved on was somewhere else.
   *
   * So the sheet is drawn here. `SheetFillSurface` was already able to do this — it measures
   * whatever box it is given and makes itself exactly as tall as the page needs, so the whole
   * page is on screen with nothing cropped, at whatever width the row happens to be. It never
   * needed a pop-up; it had one because that is where it was first built.
   *
   * One request answers everything: the values, which paper they are written on, and whether this
   * viewer may correct them. Asked of the route that has already decided the viewer may see this
   * run at all — a teammate's car is not readable through the car routes, which is what used to
   * drop their sheets to the legacy field list.
   *
   * The pop-up survives as the COMPARE door: a comparison paints a second setup into the same
   * boxes and carries its own picker, which is a different job from reading your own sheet.
   */
  const [inlineSheet, setInlineSheet] = useState<InlineSheet | null>(null);
  const [inlineSheetFailed, setInlineSheetFailed] = useState(false);
  const wantsSheet = face === "setup";
  const snapshotId = run.setupSnapshot?.id ?? null;
  useEffect(() => {
    if (!wantsSheet || !snapshotId) return;
    let alive = true;
    /*
     * Cleared before the request, not after it. A correction mints a NEW snapshot and this effect
     * re-runs on its id; without the clear, the old numbers would stay painted on the paper for
     * as long as the fetch takes, presented as this run's, with nothing on screen saying so.
     */
    setInlineSheet(null);
    setInlineSheetFailed(false);
    void fetch(`/api/runs/${encodeURIComponent(run.id)}/setup-snapshot?sheet=1`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed_${res.status}`);
        return (await res.json()) as {
          setupSnapshot?: { data?: unknown } | null;
          save?: SetupSaveContext | null;
          sheet?: {
            sheetMode?: boolean;
            setupSheetModelId?: string | null;
            editionBlankId?: string | null;
            template?: SetupSheetTemplate | null;
          } | null;
        };
      })
      .then((payload) => {
        if (!alive) return;
        const onSheet = Boolean(payload.sheet?.sheetMode && payload.sheet?.setupSheetModelId);
        setInlineSheet({
          // Through the same normaliser the pop-up uses, so a value cannot mean one thing on the
          // sheet drawn here and another on the sheet drawn there.
          values: normalizeSetupData(payload.setupSnapshot?.data ?? {}),
          save: payload.save ?? null,
          sheetModelId: onSheet ? payload.sheet!.setupSheetModelId! : null,
          editionBlankId: onSheet ? (payload.sheet?.editionBlankId ?? null) : null,
          template: payload.sheet?.template ?? null,
        });
      })
      .catch(() => {
        if (alive) setInlineSheetFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [wantsSheet, run.id, snapshotId]);

  /**
   * May this viewer correct the setup from here? `action === "mark"` is the server's own answer to
   * "is this the driver who logged it" — a teammate reads the sheet and copies it, never corrects
   * it — and the PATCH behind the save bar tests it again underneath. This is the affordance.
   */
  const canCorrectSetup = Boolean(
    allowRunMutations && snapshotId && run.carId && inlineSheet?.save?.action === "mark"
  );
  /** Armed only where the editor is actually on screen: the Setup face, in edit mode, as owner. */
  const sheetEditing = canCorrectSetup && editing && face === "setup";

  /*
   * ============================== NOTHING IN HERE THROWS TYPING AWAY ==============================
   *
   * The same rule `SetupSheetModal` follows, for the same reason and with the same sheet: the
   * editor is an ordinary React subtree, so any exit that simply stops rendering it takes the
   * driver's numbers with it. `beforeunload` (armed inside `useSetupEditorSave`) covers leaving
   * the site and nothing else — none of these exits unload anything.
   *
   * Three exits reach the armed editor, and all three ask:
   *   1. **Cancel** — the run's own Edit toggle, which unarms the sheet.
   *   2. **Another face** — Laps or Notes unmounts the Setup face under it.
   *   3. **Folding the row** — the header button, which belongs to the LIST, not to this card.
   *      It asks through `runSetupEditGuard`; see that file for why it cannot ask directly.
   */
  const [hostedSave, setHostedSave] = useState<HostedSetupSave | null>(null);
  // Identity-stable so the editor below is not re-rendered by a prop that only looks new.
  const publishHostedSave = useCallback((state: HostedSetupSave | null) => {
    setHostedSave(state);
  }, []);
  const unsavedSetupCount = hostedSave?.dirty ? hostedSave.changedCount : 0;
  /**
   * The exit that is waiting, and what it will do once the driver has decided. The COUNT is frozen
   * here rather than read live: a landed save unmounts the editor, and a title recomputed from live
   * state would flash "0 unsaved changes" on its way out.
   */
  const [exitPrompt, setExitPrompt] = useState<{ count: number; proceed: () => void } | null>(null);
  const [exitSaving, setExitSaving] = useState(false);

  /** Every exit this card owns goes through here. A clean sheet just leaves. */
  const leaveSheetEditor = useCallback(
    (proceed: () => void) => {
      if (unsavedSetupCount > 0) setExitPrompt({ count: unsavedSetupCount, proceed });
      else proceed();
    },
    [unsavedSetupCount]
  );

  // Published only while there is something to lose — a stale entry would make a row with nothing
  // at stake refuse to fold.
  useEffect(() => {
    if (unsavedSetupCount <= 0) {
      registerRunSetupExitAsk(run.id, null);
      return;
    }
    registerRunSetupExitAsk(run.id, (proceed) =>
      setExitPrompt({ count: unsavedSetupCount, proceed })
    );
    return () => registerRunSetupExitAsk(run.id, null);
  }, [run.id, unsavedSetupCount]);

  const discardAndExit = useCallback(() => {
    const proceed = exitPrompt?.proceed;
    setExitPrompt(null);
    setHostedSave(null);
    proceed?.();
  }, [exitPrompt]);

  const saveAndExit = useCallback(async () => {
    if (!hostedSave || !exitPrompt) return;
    setExitSaving(true);
    const landed = await hostedSave.save().catch(() => false);
    setExitSaving(false);
    // A refusal keeps the sheet and the sentence that says why — leaving now would still lose it.
    if (!landed) return;
    const proceed = exitPrompt.proceed;
    setExitPrompt(null);
    proceed();
  }, [hostedSave, exitPrompt]);

  /**
   * What a landed correction sets off — the same handler the pop-up hands back, because it is the
   * same save. "Did your other runs have this wrong too?" goes straight into this card's queue,
   * and the refresh is what repoints the row at the snapshot the save just minted.
   */
  const handleSetupCorrected = useCallback(
    (result: SetupEditorSavedResult) => {
      corrections.offerCorrections(result.corrections, result.suppressed);
      router.refresh();
    },
    [corrections, router]
  );

  const [lapsOpen, setLapsOpen] = useState(false);
  const lapComparePickerRuns = useMemo(
    () =>
      allowRunMutations && run.carId
        ? pickerRuns.filter((r) => r.car?.id === run.carId)
        : pickerRuns,
    [allowRunMutations, pickerRuns, run.carId]
  );

  const [prepOpen, setPrepOpen] = useState(false);
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const [pendingCarMove, setPendingCarMove] = useState<{ id: string; label: string } | null>(null);
  const [carMoveBusy, setCarMoveBusy] = useState(false);
  const [carMoveError, setCarMoveError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = useCallback(async () => {
    if (deleting) return;
    const when = formatRunDateTime(resolveRunDisplayInstant(run), runZone);
    const ok = window.confirm(
      `Delete ${carDisplay} run from ${when}?\n\nThis removes the run and its lap data. Setup snapshots are kept.`
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Delete failed (${res.status})`);
      }
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete run");
      setDeleting(false);
    }
  }, [carDisplay, deleting, onDeleted, router, run, runZone]);

  /*
   * The three pieces the race-field notebook hosts, built once here because the
   * switcher needs them separately (stats above the tabs, the lap card as the
   * notebook page, the trace below) AND together (`userView`, for a run with no
   * multi-driver import). Same arrangement the run page has always passed.
   */
  /*
   * All three take a driver's numbers as arguments rather than closing over yours,
   * and that is the whole point: the race-field notebook hands the same three
   * builders back for a *competitor's* tab (see `driverChrome` below), so a rival's
   * laps are drawn by the code that draws yours. Before this, a rival's tab wore an
   * older instrument panel — eight stat wells and a bare lap grid — and switching
   * tabs changed the design language, not just the driver (founder call, 2026-08-25).
   */
  const cardShell = (children: ReactNode) => (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">{children}</div>
  );

  const numbersLineFor = (
    metrics: IncludedLapDashboardMetrics,
    fade: { perLap: number | null; overRunSeconds: number | null },
    /** Says what the row is where the labels can't — the field tab's average, say. */
    title?: string,
    opts?: {
      /**
       * The pinned row above already shows the 5-minute stint, so this row must not —
       * the same figure twice on one card is two answers to one question. Only your
       * own row sets this; a rival's tab has no pinned row, so the stint takes the
       * whole-session Stint figure's seat there instead.
       */
      fiveMinShownAbove?: boolean;
    }
  ) => (
    <div
      className="flex items-stretch rounded-xl border border-border bg-card px-1 py-1.5"
      title={title}
    >
      {metrics.fiveMinStint != null && opts?.fiveMinShownAbove ? null : metrics.fiveMinStint !=
        null ? (
        <Figure
          label="5 min"
          value={formatFiveMinuteStint(metrics.fiveMinStint, 1)}
          title={formatFiveMinuteStint(metrics.fiveMinStint)}
          small
        />
      ) : (
        <Figure
          label="Stint"
          value={metrics.stintSeconds != null ? formatStintTime(metrics.stintSeconds) : "—"}
          small
        />
      )}
      <Figure label="Median" value={formatLap(metrics.median)} small />
      <Figure
        label="Consist."
        value={
          metrics.consistencyScore != null
            ? formatConsistencyScorePercent(metrics.consistencyScore)
            : "—"
        }
        small
      />
      {/*
        Fade took the mistake count's place here (founder, 2026-08-27): the mistakes are
        still painted on the laps below, where a count of them was the one figure a reader
        could already see for themselves. The rate is what they couldn't. Positive = the
        run got slower; the hover spreads it back over the run ("≈ +0.6 s over the run").
      */}
      <Figure
        label="Fade"
        value={formatFadePerLap(fade.perLap)}
        title={formatFadeOverRun(fade.overRunSeconds)}
        small
      />
    </div>
  );

  const lapCardFor = (
    rows: LapGraphRow[],
    opts: {
      bestLap: number | null;
      best: Set<number>;
      mistake: Set<number>;
      /** Real "+0.42s vs median" detail where the caller has it; a plain word where it doesn't. */
      mistakeDetail?: Map<number, string>;
      /** What stands in when a driver has no laps at all. */
      empty: ReactNode;
      /** Laps inside the 5-minute window — tinted so the stint is on the picture. */
      window?: Set<number>;
      /** The "back to auto" control, shown in the header while the window is hand-placed. */
      windowChip?: ReactNode;
      /** Owner-only: tapping a lap opens the 5-minute window there. */
      onPickWindowStart?: (lapNumber: number) => void;
    }
  ) =>
    cardShell(
      rows.length > 0 ? (
        <>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-faint">
              Lap times
            </span>
            {opts.windowChip ?? null}
            {opts.bestLap != null ? (
              <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
                {rows.length} lap{rows.length === 1 ? "" : "s"} · best {formatLap(opts.bestLap)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px]">
            {rows.map((lap) => {
              const isMistake = opts.mistake.has(lap.lapNumber);
              const isBest = opts.best.has(lap.lapNumber);
              const detail = opts.mistakeDetail?.get(lap.lapNumber);
              const inWindow = opts.window?.has(lap.lapNumber) ?? false;
              const title = !lap.isIncluded
                ? "Excluded"
                : isMistake
                  ? detail
                    ? `${detail} vs median`
                    : "Mistake lap"
                  : isBest
                    ? "Best lap"
                    : opts.onPickWindowStart
                      ? "5-min window from here"
                      : undefined;
              const chipClass = cn(
                "inline-grid grid-cols-[1.4rem_auto] items-baseline gap-x-0.5 rounded px-0.5 tabular-nums",
                // The window tint sits UNDER the flag colours: a mistake inside the
                // window is still a mistake, and the window still counts its time.
                inWindow && !isMistake && !isBest && "bg-secondary",
                !lap.isIncluded && "line-through opacity-50",
                isMistake && "lap-flag-mistake text-white",
                isBest && !isMistake && "lap-flag-best text-white"
              );
              const inner = (
                <>
                  <span
                    className={cn(
                      "text-right",
                      isMistake || isBest ? "text-white/75" : "text-faint"
                    )}
                  >
                    {lap.lapNumber}.
                  </span>
                  <span>{lap.lapTimeSeconds.toFixed(3)}s</span>
                </>
              );
              return opts.onPickWindowStart ? (
                <button
                  key={lap.lapNumber}
                  type="button"
                  onClick={() => opts.onPickWindowStart!(lap.lapNumber)}
                  title={title}
                  className={cn(chipClass, "tap-active")}
                >
                  {inner}
                </button>
              ) : (
                <span key={lap.lapNumber} title={title} className={chipClass}>
                  {inner}
                </span>
              );
            })}
          </div>
        </>
      ) : (
        opts.empty
      )
    );

  const numbersLine = numbersLineFor(dash, fade, undefined, { fiveMinShownAbove: true });

  const lapCard = lapCardFor(graphRows, {
    bestLap: dash.bestLap ?? null,
    best: bestLapNumbers,
    mistake: mistakeLapNumbers,
    window: fiveMinWindowLapNumbers,
    windowChip: fiveMinIsCustom && fiveMinStint ? (
      <button
        type="button"
        onClick={() => saveFiveMinStart(null)}
        className="tap-active rounded-full border border-border bg-secondary px-2 text-[9.5px] font-semibold tabular-nums text-muted-foreground hover:text-foreground"
        title="Back to the best five minutes"
      >
        5 min: laps {fiveMinStint.startLapNumber}–{fiveMinStint.endLapNumber} ✕
      </button>
    ) : null,
    onPickWindowStart:
      allowRunMutations && dash.fiveMinStint != null ? pickFiveMinStart : undefined,
    empty: (
      <p className="text-[12.5px] text-muted-foreground">
        {"No lap times on this run yet. "}
        <Link
          href={lapImportHref(run.id)}
          className="font-semibold text-primary-ink underline-offset-2 hover:underline"
        >
          Import laps
        </Link>
      </p>
    ),
  });

  const lapGraph = (lineColor?: string) =>
    graphRows.length >= 3
      ? cardShell(
          <LapTimeGraph
            rows={graphRows}
            bestLapNumbers={bestLapNumbers}
            mistakeLapNumbers={mistakeLapNumbers}
            mistakeDetailByLapNumber={emptyMistakeDetail}
            medianSeconds={dash.median ?? null}
            lineColor={lineColor}
            fadeProfile={fadeProfile}
          />
        )
      : null;

  const shareable = runIsShareable(run, Boolean(run.setupSnapshot?.id));
  const shareLabel = [
    run.event?.name ?? null,
    formatRunSessionDisplay(run, { fallback: "Testing run" }),
    trackDisplay,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("flex flex-col gap-2 border-l-2 border-primary bg-muted/40 px-2.5 py-3", className)}>
      {/* ── pinned: how fast, and how it felt ───────────────────────────── */}
      <div className="flex items-stretch rounded-xl border border-border bg-card px-1 py-2">
        <Figure label="Best" value={formatLap(dash.bestLap)} tone="gain" />
        <Figure label="Top 5" value={formatLap(dash.avgTop5)} />
        {/*
          The 5-minute stint — best consecutive five minutes, laps/time the way LiveRC
          posts a result — is the headline pace figure (founder call, 2026-08-31: "best,
          top five, then five-minute stint"). It takes BOTH Top 10's and Laps' seats when
          the session is long enough to have one: a "18/5:07.6" cell is physically ~2 cells
          wide at 390px (measured — five cells + the dial truncated every value), the lap
          count is already the front half of the figure, and Top 10's over-a-run question
          is what the stint answers. One decimal in the cell; the full three ride on hover.
        */}
        {fiveMinStint != null ? (
          <Figure
            label="5 min"
            value={formatFiveMinuteStint(fiveMinStint, 1)}
            title={
              fiveMinIsCustom && dash.fiveMinStint != null
                ? `${formatFiveMinuteStint(fiveMinStint)} from lap ${fiveMinStint.startLapNumber} · best ${formatFiveMinuteStint(dash.fiveMinStint)}`
                : formatFiveMinuteStint(fiveMinStint)
            }
            wide
          />
        ) : (
          <>
            <Figure label="Top 10" value={formatLap(dash.avgTop10)} />
            <Figure label="Laps" value={String(dash.lapCount)} />
          </>
        )}
        <div className="flex flex-1 items-center justify-center px-1">
          {/*
            The dashboard's dial, not "7/10". Same ring, same band ramp, same word —
            a driver reads one glyph they already know rather than parsing a fraction
            for the second time on the same screen.

            No caption under it: `RatingDial` prints the band word itself, so a label
            of my own put "Good / GOOD" in one cell (seen on the real page, not
            guessed). The word IS this cell's label.
          */}
          <RatingDial size={32} value={rating} min={1} label="Handling" />
        </div>
      </div>

      {/*
        ── pinned: everything the run RAN ON ──────────────────────────────

        Three lines, and none of them belongs to a face (founder call, 2026-08-25):
        the machine, what was on the rubber, and the day. These are exactly the
        things that differ between two runs on one afternoon, and while they lived
        inside the Setup face you had to open Setup on each run in turn to compare
        them — which is the thing opening runs in place exists to stop.

        The prep collapses to the app's own one-line form (`formatTirePrepLine`,
        "Mighty Gripper · 10m warmers 80°C"). The numbered step list with its glyphs
        is a panel, and a panel belongs where prep is EDITED, not in a pinned strip.

        In edit mode this block is where the car, the tyre set, its run number and
        the additive are corrected — the controls follow the values.
      */}
      <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          {canEdit ? (
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
            <span className="min-w-0 truncate font-semibold text-foreground">{carDisplay}</span>
          )}
          {run.tireType || canEdit ? (
            <>
              <span className="h-3 w-px shrink-0 bg-border" aria-hidden />
              {/*
                No tyre ring here. The ring exists to say "run N on this rubber" in a
                glyph, for places with no room for words — a chart gutter, a collapsed
                row. This line has the words, so the ring was the same fact drawn twice
                (founder call, 2026-08-25).
              */}
              <span className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate tabular-nums">
                  {canEdit ? (
                    <InlinePickEdit
                      ariaLabel="Tire set"
                      value={run.tireType?.displayName ?? "—"}
                      valueId={run.tireType?.id ?? null}
                      loadOptions={async () => (await loadPickerOptions()).tireTypes}
                      allowEmpty
                      onSave={(next) => corrections.saveFields({ tireTypeId: next })}
                      align="left"
                    />
                  ) : (
                    <span className="font-semibold text-foreground">
                      {run.tireType?.displayName}
                    </span>
                  )}
                  {run.tireType ? (
                    <>
                      {" · run "}
                      {canEdit ? (
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
                      ) : (
                        run.tireRunNumber
                      )}
                      {run.tireAgeKnown === false ? " (age unknown)" : ""}
                    </>
                  ) : null}
                </span>
              </span>
            </>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <InlinePickEdit
              ariaLabel="Additive"
              value={run.additiveType?.displayName ?? "—"}
              valueId={run.additiveType?.id ?? null}
              loadOptions={loadAdditiveOptions}
              allowEmpty
              onSave={corrections.saveAdditive}
              align="left"
            />
            {prepSequenceLine ? <span className="truncate">· {prepSequenceLine}</span> : null}
            <button
              type="button"
              onClick={() => setPrepOpen(true)}
              className="font-semibold text-primary-ink underline-offset-2 hover:underline"
            >
              {prepSequenceLine ? "change prep" : "add prep"}
            </button>
          </div>
        ) : prepLine ? (
          <div className="truncate">{prepLine}</div>
        ) : null}

        {weatherLine ? <div className="truncate tabular-nums">{weatherLine}</div> : null}
      </div>

      {/* ── the faces ───────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="What to read about this run"
        className="flex gap-1 rounded-xl border border-border bg-secondary p-1"
      >
        {FACES.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={face === f.id}
            /* Leaving Setup unmounts the armed sheet under it — see the exits note above. */
            onClick={() => (f.id === face ? undefined : leaveSheetEditor(() => setFace(f.id)))}
            className={cn(
              "tap-active min-h-9 flex-1 rounded-lg px-2 text-[12px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              face === f.id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {face === "laps" ? (
        /*
          The race field, restored (2026-08-25).
          
          `RunRaceFieldSwitcher` is the notebook of driver tabs over a LiveRC-style
          multi-driver import: every entrant's laps, in classification order, with your
          own trace under theirs as a dashed baseline. It has lived on the run page
          since it was built, and it came off the surfaces that matter the moment
          nothing pointed at that page any more — which on a race weekend removes the
          competitive lap times entirely. It is HOSTED here unchanged, arranged exactly
          as the run page arranged it: your figures, then the tabs, then the lap card
          and the trace.
          
          A run with no multi-driver import renders `userView` and no extra chrome, so
          a test day never grows a tab strip.
        */
        <RunRaceFieldSwitcher
          runId={run.id}
          enabled={(run.importedLapSets?.length ?? 0) > 0}
          userLapRows={graphRows}
          userStats={numbersLine}
          userLapCard={lapCard}
          userGraph={lapGraph(RACE_IDENTITY.you)}
          driverChrome={{
            stats: (f) => numbersLineFor(f.dash, f.fade, f.statsTitle),
            lapCard: (f) =>
              lapCardFor(f.rows, {
                bestLap: f.dash.bestLap ?? null,
                best: f.bestLapNumbers,
                mistake: f.mistakeLapNumbers,
                mistakeDetail: f.mistakeDetailByLapNumber,
                empty: <p className="text-[12.5px] text-muted-foreground">No laps for this driver.</p>,
              }),
            frameGraph: cardShell,
          }}
          userView={
            <div className="flex min-w-0 flex-col gap-2">
              {numbersLine}
              {lapCard}
              {lapGraph()}
            </div>
          }
        />
      ) : null}

      {face === "setup" ? (
        <>
          <Block
            label={
              setupDiff?.mode === "diff" && setupDiff.previousLabel
                ? `Setup vs ${setupDiff.previousLabel}`
                : "Setup vs previous run"
            }
            aside={
              setupDiff?.mode === "diff" && setupDiff.rows.length > 0
                ? `${setupDiff.rows.length} change${setupDiff.rows.length === 1 ? "" : "s"}`
                : null
            }
          >
            {setupDiff == null ? (
              <p className="text-[12.5px] text-muted-foreground">Setup not loaded for this session.</p>
            ) : setupDiff.mode === "no_setup" ? (
              <p className="text-[12.5px] text-muted-foreground">No setup was recorded on this run.</p>
            ) : setupDiff.mode === "no_baseline" ? (
              <SetupChangedSincePreviousList rows={null} runId={run.id} />
            ) : (
              <SetupChangedSincePreviousList rows={setupDiff.rows} runId={run.id} />
            )}
          </Block>

          {/*
            ── the sheet itself ────────────────────────────────────────────

            Its own card rather than a second half of the block above, because it answers a
            different question: that one is "what moved", this one is "what the car WAS". The
            padding is deliberately narrower than `Block`'s — every pixel taken off the sides is a
            pixel of readable sheet on a 390px phone, and the page is drawn to whatever width it
            is given.
          */}
          {snapshotId ? (
            <div className="rounded-xl border border-border bg-card px-1.5 py-2.5">
              <div className="relative mb-2 flex items-center gap-2 px-1.5">
                <span className="text-[9.5px] font-semibold uppercase tracking-wider text-faint">
                  {sheetEditing ? "Correcting the sheet" : "The sheet"}
                </span>
                {/*
                  The pop-up, kept for the one job it still does better: a comparison paints a
                  SECOND setup into these boxes and needs a picker for it. Closed off while the
                  sheet here is armed — a fillable box showing one value and writing to another is
                  the bug the modal already ruled out for itself.
                */}
                {/*
                  The bookmark from the All-setups list, at the paper it saves (founder ask,
                  2026-08-31): mark on your own run, copy on a teammate's — the same control the
                  Compare pop-up already carries. Keyed by snapshot so a correction's new id does
                  not inherit the old one's Saved state. Both this and Compare wear ml-auto: the
                  first consumes the free space, the second's collapses, so Compare stays put
                  while the sheet (and its save context) is still loading. The header row is
                  relative for the copy flavour's own panel.
                */}
                {inlineSheet?.save && snapshotId ? (
                  <SessionSetupSaveButton
                    key={snapshotId}
                    setupId={snapshotId}
                    save={inlineSheet.save}
                    className="ml-auto min-h-8 text-[11px] font-semibold"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={openSetupSheet}
                  disabled={sheetLoading || sheetEditing}
                  title={
                    sheetEditing
                      ? "Finish or cancel your corrections first — a comparison paints another setup into these boxes"
                      : "Compare this run's setup to another run"
                  }
                  className={cn(
                    "tap-active ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border",
                    "bg-secondary px-2.5 text-[11px] font-semibold text-foreground transition-colors",
                    "hover:border-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    (sheetLoading || sheetEditing) && "opacity-50"
                  )}
                >
                  <GitCompare className="h-3.5 w-3.5" aria-hidden />
                  {sheetLoading ? "Opening…" : "Compare"}
                </button>
              </div>

              {inlineSheetFailed ? (
                <p className="px-1.5 text-[12.5px] text-muted-foreground">
                  Couldn’t load this run’s setup sheet.
                </p>
              ) : !inlineSheet ? (
                <p className="px-1.5 text-[12.5px] text-muted-foreground">Opening the sheet…</p>
              ) : sheetEditing ? (
                /*
                 * The same paper, fillable. `SheetSetupEditorClient` and `ReadOnlySheetSurface` are
                 * both thin wrappers over one `SheetFillSurface`, so a box does not move a pixel
                 * between reading and correcting.
                 *
                 * `correctRun` is the ONLY safe write for a run's setup: `Run.setupSnapshotId` has
                 * no unique constraint and "mark, not copy" can leave a named library setup on the
                 * same row, so a plain snapshot PATCH hard-refuses a snapshot with runs on it.
                 *
                 * Keyed by snapshot so a correction re-seeds the editor from what it just wrote.
                 */
                inlineSheet.sheetModelId ? (
                  <SheetSetupEditorClient
                    key={`edit:${snapshotId}`}
                    carId={run.carId!}
                    setupId={snapshotId}
                    saveMode={{ kind: "correctRun", runId: run.id }}
                    setupSheetModelId={inlineSheet.sheetModelId}
                    editionBlankId={inlineSheet.editionBlankId}
                    initialValues={inlineSheet.values}
                    templateKey={inlineSheet.template?.templateKey}
                    hosted
                    onSaved={handleSetupCorrected}
                    onSaveStateChange={publishHostedSave}
                  />
                ) : inlineSheet.template ? (
                  <LibrarySetupEditorClient
                    key={`edit:${snapshotId}`}
                    carId={run.carId!}
                    setupId={snapshotId}
                    saveMode={{ kind: "correctRun", runId: run.id }}
                    initialValues={inlineSheet.values}
                    template={inlineSheet.template}
                    hosted
                    onSaved={handleSetupCorrected}
                    onSaveStateChange={publishHostedSave}
                  />
                ) : null
              ) : inlineSheet.sheetModelId ? (
                <ReadOnlySheetSurface
                  setupSheetModelId={inlineSheet.sheetModelId}
                  editionBlankId={inlineSheet.editionBlankId}
                  values={inlineSheet.values}
                  templateKey={inlineSheet.template?.templateKey}
                  labLabels={{ s: "This run" }}
                  labSource={{ kind: "run", id: run.id }}
                />
              ) : inlineSheet.template ? (
                /* No drawable chassis — the legacy field list, which is still a real setup view. */
                <SetupSheetView
                  key={inlineSheet.template.id}
                  value={inlineSheet.values}
                  onChange={noop}
                  readOnly
                  template={inlineSheet.template}
                />
              ) : (
                <p className="px-1.5 text-[12.5px] text-muted-foreground">
                  This car has no setup sheet yet. Add one from the car page and this run’s numbers
                  draw on it.
                </p>
              )}

              {/*
                Says how to get IN, on the surface that can't say it any other way — the sheet is a
                picture, and nothing on it looks pressable until edit mode is on.
              */}
              {canCorrectSetup && !sheetEditing ? (
                <p className="px-1.5 pt-1.5 text-[11px] text-muted-foreground">
                  Press <span className="font-semibold text-foreground">Edit</span> below to correct
                  these numbers on the sheet.
                </p>
              ) : null}
              {sheetError ? (
                <p className="px-1.5 pt-1.5 text-[11px] text-destructive">{sheetError}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {face === "notes" ? (
        <Block label="Notes" aside={rating != null ? `${rating}/10 · ${ratingWordFor(rating)}` : null}>
          {canEdit ? (
            <div className="flex flex-col gap-3">
              <AutoGrowTextarea
                minRows={2}
                defaultValue={note}
                aria-label="Run notes"
                placeholder="What happened out there?"
                onBlur={(e) => {
                  const next = e.currentTarget.value.trim();
                  if (next === note) return;
                  void corrections.saveFields({ notes: next });
                }}
                className="w-full rounded-md border border-ring/40 bg-background px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-ring"
              />
              {/*
                The same controls used when logging — the driver answered by placing a dot
                on a lane and raising a staircase, and correcting it should not mean
                answering a different question.
              */}
              <CarHandlingRatingQuickPick
                value={rating}
                onChange={(next) => void corrections.saveFields({ carRating: next })}
              />
              <HandlingAssessmentFields
                value={feel.ui}
                onChange={(next) =>
                  void corrections.saveFields({ handlingAssessmentJson: persistedFromUiState(next) })
                }
              />
            </div>
          ) : feel.chips.length > 0 || note || problems ? (
            <div className="flex flex-col gap-2">
              {feel.chips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {feel.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
              {problems ? (
                <p className="text-[12.5px] leading-relaxed text-foreground">{problems}</p>
              ) : null}
              {note ? (
                <p className="text-[12.5px] leading-relaxed text-foreground">
                  <span className="text-faint">&ldquo;</span>
                  {note}
                  <span className="text-faint">&rdquo;</span>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Nothing logged about how the car felt on this run.
            </p>
          )}
        </Block>
      ) : null}

      {/* ── the doors ───────────────────────────────────────────────────── */}
      <div role="group" aria-label="Run actions" className="flex gap-1.5">
          {/*
            The Engineer is one tile wide, and the only one wearing a face (founder, 2026-08-26).

            It spent an hour as a full-width bar in the dashboard CTA's shape — "too big". The
            size was never the ask: five identical tiles with one of them tinted made the door a
            driver actually wants read as merely the yellow one of five. So it keeps the row's
            geometry and takes the CTA's SURFACE instead — the lit rim, and the sheen band that
            crosses it.

            `.logrun-fx` was reserved to the dashboard CTA and the dock's log-run circle on
            2026-08-18, after a day of every yellow button wearing it taught us that ten shining
            things on one screen make shine mean nothing. This is the third, and on founder
            instruction: at most one of these is ever on screen, inside an opened run, so the band
            still marks a single object rather than a style. Do not spread it further.
          */}
          <Action
            label="Engineer"
            primary
            onClick={() => router.push(`/engineer?pin=run:${encodeURIComponent(run.id)}`)}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
          />
          {/*
            "Lap times", not "Compare" (founder call, 2026-08-26). It opens this run's laps — the
            graph, the mistakes, the stint — and a second run beside them is one option INSIDE that,
            not the door's whole subject. "Compare" named the option and left the driver guessing
            what they were comparing, on a panel that also carries a setup-compare of its own. A
            stopwatch says what is behind it in one glyph.
          */}
          <Action
            label="Lap times"
            onClick={() => setLapsOpen(true)}
            icon={<Timer className="h-4 w-4" aria-hidden />}
          />
        {allowRunMutations ? (
          /*
            ============================== WHY IT SAYS "CANCEL" OVER THE SHEET ==============================

            Everywhere else on this card an edit lands the moment it is made — pick a tyre set and
            it is saved — so "Done" is honest: it puts the underlines away and nothing is pending.
            The sheet is the one thing that batches. Ten boxes are typed and ONE save bar at the
            bottom of the paper writes them, so a button up here reading "Done" would be claiming
            to finish something it does not write, with the real door out of sight below it. That
            exact pair — a top button that saves nothing above a save bar that does — is the bug
            the setup pop-up shipped and had pulled on 2026-08-24; it is not being rebuilt here.

            So while the sheet is armed this is the way BACK, it is called Cancel, and it asks
            first if there is anything to lose.
          */
          <Action
            label={sheetEditing ? "Cancel" : editing ? "Done" : "Edit"}
            pressed={editing && !sheetEditing}
            onClick={() => (editing ? leaveSheetEditor(() => setEditing(false)) : setEditing(true))}
            icon={<SquarePen className="h-4 w-4" aria-hidden />}
          />
        ) : null}
        {shareable ? (
          <div className="flex-1">
            <ShareRunButton
              runId={run.id}
              runLabel={shareLabel}
              setupSnapshotId={run.setupSnapshot?.id ?? null}
              className="h-full w-full flex-col gap-1 rounded-lg px-1 py-2 text-[9.5px]"
            />
          </div>
        ) : null}
        {/*
          Delete only inside edit mode — the one irreversible control does not belong
          on a surface whose whole job is reading.
        */}
        {canEdit ? (
          <Action
            label="Delete"
            danger
            disabled={deleting}
            onClick={handleDelete}
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          />
        ) : null}
      </div>
      {deleteError ? <p className="text-[11px] text-destructive">{deleteError}</p> : null}

      {/* ── overlays ────────────────────────────────────────────────────── */}
      {/*
        The one question every exit from the armed sheet asks. Same Save / Discard / Stay shape
        the log-run wizard and the setup pop-up use, because the useful answer to "you have three
        changes" is usually to save them — sending the driver back to hunt for a bar at the bottom
        of a scrolled card is a worse ask than the one that lost the changes in the first place.
      */}
      <ExitPromptSheet
        open={exitPrompt !== null}
        title={
          exitPrompt?.count === 1 ? "1 unsaved change" : `${exitPrompt?.count ?? 0} unsaved changes`
        }
        detail="Leaving the sheet now puts every box back the way you found it."
        saveLabel={hostedSave?.saveLabel ?? "Correct this run"}
        discardLabel="Discard changes"
        stayLabel="Keep editing"
        error={hostedSave?.error ?? null}
        busy={exitSaving || Boolean(hostedSave?.busy)}
        onSave={() => void saveAndExit()}
        onDiscard={discardAndExit}
        onStay={() => setExitPrompt(null)}
      />
      {sheetModal ? (
        <SetupSheetModal
          open
          onClose={() => setSheetModal(null)}
          run={sheetModal.run}
          pickerRuns={sheetModal.pickerRuns}
          runListSource={runListSource}
          viewerUserId={null}
          /*
           * The same handler the inline sheet uses, and for the same reason: a correction
           * made in the pop-up earns the same questions as one made in the face. This door
           * refreshed and nothing else until 2026-08-25, which threw every question away —
           * the cascade worked from `/runs/[id]` and was dead on the surfaces that replaced
           * it (founder-reported).
           */
          onRunSetupCorrected={allowRunMutations ? handleSetupCorrected : undefined}
        />
      ) : null}
      {lapsOpen ? (
        <RunLapAnalysisModal
          open={lapsOpen}
          onClose={() => setLapsOpen(false)}
          run={run}
          pickerRunsSameCar={lapComparePickerRuns}
          dayRuns={pickerRuns}
          runListSource={runListSource}
          userDisplayName={runOwnerDisplayName}
          runOwnedByViewer={allowRunMutations}
          viewerUserId={null}
        />
      ) : null}
      {allowRunMutations ? (
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
              // One PATCH for both: the additive is stamped into the setup snapshot
              // server-side as well as onto the run.
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
      ) : null}
    </div>
  );
}

/** Band word for the pinned dial's caption. Mirrors `carRatingBandCaption`'s grouping. */
function ratingWordFor(rating: number): string {
  if (rating <= 3) return "Bad";
  if (rating <= 6) return "Workable";
  if (rating <= 8) return "Good";
  return "Dialled";
}

/** One figure in a strip — the pinned pace row, and the Laps face's numbers line. */
function Figure({
  label,
  value,
  tone,
  small,
  title,
  wide,
}: {
  label: string;
  value: string;
  tone?: "gain";
  /** The secondary line: same shape, a size down, so the pinned row still leads. */
  small?: boolean;
  /** Hover detail for the one figure whose felt size isn't its own unit (fade). */
  title?: string;
  /** A ~1.5 flex share for the one figure that is laps AND a clock ("18/5:07.6"). */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        // px-0.5, not px-1: measured at 390px with the 5-minute stint in the row,
        // "16.566" needed 63px of a 62px cell — the gutter was the missing pixel.
        "flex min-w-0 flex-col items-center justify-center border-r border-border px-0.5 last:border-r-0",
        wide ? "flex-[1.5]" : "flex-1"
      )}
      title={title}
    >
      {/* max-w-full so truncate actually clips: in a column flex the span otherwise
          sizes to its content and a long value bleeds into the neighbouring cell
          (seen at 390px the day the 5-minute stint joined the row). */}
      <span
        className={cn(
          "max-w-full truncate font-semibold leading-tight tabular-nums",
          small ? "text-[13px]" : "text-[15px]",
          tone === "gain" ? "text-gain" : "text-foreground"
        )}
      >
        {value}
      </span>
      <span className="mt-px text-[8.5px] font-semibold uppercase tracking-[0.07em] text-faint">
        {label}
      </span>
    </div>
  );
}

/** One titled shelf inside a face. Label left, one figure right. */
function Block({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </span>
        {aside ? (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">{aside}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}


function Action({
  label,
  icon,
  onClick,
  primary,
  danger,
  pressed,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        "tap-active relative isolate flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2",
        "text-[9.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        primary
          ? [
              "bg-primary font-semibold text-primary-foreground overflow-hidden",
              /*
                The CTA's surface, on a tile (founder, 2026-08-26). Every light source lives at
                the RIM — cream along the top edge, bronze along the bottom, a whisper down each
                side — because nothing soft can be laid over #FFD60A without desaturating it: red
                is pinned at 255 and green sits near it, so a white wash only raises blue, which
                is the channel that stops a colour being yellow.

                No border. A ring on a saturated fill reads as a sticker (2026-08-25, three rims
                tried and three pulled); the inset top and bottom lines ARE the edge here.
              */
              "shadow-[0_8px_20px_-10px_rgba(255,214,10,0.6),inset_0_1.5px_0_rgba(255,252,230,0.62),inset_0_-1.5px_0_rgba(122,90,0,0.3),inset_1px_0_0_rgba(255,252,230,0.18),inset_-1px_0_0_rgba(122,90,0,0.14)]",
              "hover:brightness-105 active:brightness-95",
            ]
          : danger
            ? "border border-destructive/40 bg-destructive/10 text-destructive"
            : pressed
              ? "border border-ring/40 bg-muted text-foreground"
              : "border border-border bg-card text-muted-foreground hover:border-ring/40",
        disabled && "opacity-60"
      )}
    >
      {/* The sheen band, clipped to the tile. A direct child so its containing block is the
          button; `.logrun-fx` removes itself entirely under reduced motion, where a band parked
          mid-face would read as a smear on the paint. */}
      {primary ? <span className="logrun-fx" aria-hidden /> : null}
      <span className="relative z-[2] flex flex-col items-center gap-1">
        {icon}
        <span>{label}</span>
      </span>
    </button>
  );
}
