/**
 * What goes on a shared picture — decided here, drawn elsewhere.
 *
 * Pure on purpose: no React, no `server-only`, no Prisma. The renderers turn this into pixels and
 * nothing else; every question of *what* a driver is about to publish is answered in this file,
 * where it can be unit-tested without a font, a browser, or a database (`npm run test:share`).
 *
 * Three STYLES (founder rulings 2026-08-13 and 2026-09-25):
 *
 *   story  — the 9:16 picture for an Instagram / Facebook story (`renderStoryCard.tsx`). A fixed
 *            layout: best lap, three figures, the trace. The section chips do not apply to it.
 *   hero   — the long picture, best lap first (`renderReportCard.tsx`).
 *   report — the long picture, session identity first, for the team chat.
 *
 * On the long picture the driver ticks which blocks travel. Nothing overrides anything: a chip is
 * the only thing that turns a block on or off, which was the whole complaint about the old modes
 * (they silently reset the section flags underneath the driver).
 *
 * Some things are never chip-controlled and must survive every combination: best lap, avg top 5,
 * avg top 10, laps & stint, track, date, driver name, and the JRC mark.
 *
 * Heights are NOT decided here any more. The long picture is laid out tall and cut where its
 * content ends (`renderReportCard.tsx`); the story is a fixed frame that sizes its own headlines.
 */

import {
  computeMistakeLaps,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
  formatConsistencyScorePercent,
  type LapRow,
} from "@/lib/lapAnalysis";
import { formatLap, formatStintTime } from "@/lib/runLaps";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatConditionsChip } from "@/lib/weather/conditions";
import { runConditionsFromRecord } from "@/lib/weather/runConditionsRecord";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import {
  CAPTURE_TRAIT_AXIS_KEYS,
  CAR_RATING_BANDS,
  HANDLING_TRAIT_CHIP_META,
  carRatingBandCaption,
  parseHandlingAssessmentJson,
  uiStateFromParsed,
  type PhaseBalance,
} from "@/lib/runHandlingAssessment";
import {
  formatWarmerTemp,
  normalizeTirePrep,
  tirePrepFromLegacy,
  type TirePrepStep,
} from "@/lib/runs/tirePrep";
import type { UnitSystem } from "@/lib/units/unitSystem";

/** Final image width. Everything below is measured against it. */
export const CARD_WIDTH = 1080;

/** Where a trace is drawn, in picture pixels: its box and the room kept for its axis labels. */
export type ShareTraceBox = {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
};

/**
 * The long picture's trace box: the width of the report card's content (1080 less the page's
 * 44px gutters, the card's 2px edges and its 38px padding), so `renderReportCard` draws it 1:1.
 */
export const TRACE: ShareTraceBox = {
  width: 912,
  height: 330,
  padLeft: 96,
  padRight: 14,
  padTop: 22,
  padBottom: 60,
};

/** Clean-pace ceiling, copied from `LapTimeGraph`: laps slower than best × this clamp to the top. */
const CLAMP_FACTOR = 1.15;

export type ShareCardStyle = "story" | "hero" | "report";

/** A bare or unknown value is `hero`, as it has been since the first share card. */
export function parseCardStyle(raw: string | null | undefined): ShareCardStyle {
  return raw === "report" || raw === "story" ? raw : "hero";
}

/**
 * The tickable blocks. `setup` here is the *diff* against the previous run — the setup SHEET is a
 * second picture, not a section, and lives on the sheet's own `includeSetup` flag.
 */
export type ShareSectionKey = "details" | "laps" | "graph" | "setup" | "notes" | "feel";

export const SHARE_SECTION_KEYS: readonly ShareSectionKey[] = [
  "details",
  "laps",
  "graph",
  "setup",
  "notes",
  "feel",
];

export type ShareSections = Record<ShareSectionKey, boolean>;

/** Everything travels unless the driver says otherwise. */
export function allSectionsOn(): ShareSections {
  return { details: true, laps: true, graph: true, setup: true, notes: true, feel: true };
}

/** `?sections=laps,graph` → flags. Unknown names are ignored, never an error. */
export function parseSectionsParam(raw: string | null | undefined): ShareSections {
  const wanted = new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return {
    details: wanted.has("details"),
    laps: wanted.has("laps"),
    graph: wanted.has("graph"),
    setup: wanted.has("setup"),
    notes: wanted.has("notes"),
    feel: wanted.has("feel"),
  };
}

export function serializeSections(s: ShareSections): string {
  return SHARE_SECTION_KEYS.filter((k) => s[k]).join(",");
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ShareTile = { label: string; value: string; /** Lap-derived: draw in mono. */ mono: boolean };
export type ShareWell = { label: string; value: string; mono?: boolean; lines?: string[] };
export type ShareLap = { lapNumber: number; time: string; flag: "best" | "miss" | null; excluded: boolean };
export type ShareDiffRow = { label: string; from: string; to: string };

/** One plotted lap on the trace, already in the SVG's own coordinates. */
export type ShareTraceDot = { x: number; y: number; flag: "best" | "miss" | null; clamped: boolean };
export type ShareTrace = {
  /** `x,y x,y …` for the polyline — excluded laps are skipped and the line bridges their slot. */
  points: string;
  dots: ShareTraceDot[];
  gridlines: { y: number; labelY: number; label: string }[];
  xLabels: { x: number; label: string }[];
};

/** The four rating bands, with the driver's number lit inside its own. */
export type ShareRatingBand = {
  caption: string;
  ratings: number[];
  /** The band holding the driver's rating. */
  active: boolean;
};

/** One answered corner phase. `value` is −3 (understeer) … +3 (oversteer); 0 is "felt neutral". */
export type ShareBalanceRow = { label: string; value: PhaseBalance };

/** One problem pole, flagged or not. Unflagged tiles stay — they are what was considered. */
export type ShareNotable = { label: string; severity: 1 | 2 | 3 | null };

export type ShareFeel = {
  rating: number | null;
  bandCaption: string | null;
  bands: ShareRatingBand[];
  balance: ShareBalanceRow[] | null;
  notables: ShareNotable[];
};

export type ShareRunCard = {
  style: ShareCardStyle;
  /** Hero masthead, right side. `SAT 8 AUG 2026`. */
  dateStamp: string;
  /** Report eyebrow — the event. Empty when the run belongs to no event. */
  eyebrow: string;
  /** `Qualifier 2` — the session's own name, in the display voice. */
  title: string;
  /** The driver who logged it. Null when the run has no owner name. */
  driverName: string | null;
  /** Where and in what — never chip-controlled, like the driver. */
  trackName: string | null;
  carName: string;
  eventName: string | null;
  /** Best lap, avg top 5, avg top 10, laps / time. Always present, in every style. */
  tiles: ShareTile[];
  /** Report only, `details` chip: the six session fields. */
  details: ShareWell[];
  /** Report only, never chip-gated: the nine lap figures. */
  lapWells: ShareWell[];
  laps: ShareLap[] | null;
  trace: ShareTrace | null;
  changed: ShareDiffRow[] | null;
  notes: string | null;
  feel: ShareFeel | null;
};

/** The subset of a `Run` the card reads. Mirrors `runDetailSelect` on `/runs/[id]`. */
export type ShareRunInput = {
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  lapTimes: unknown;
  lapSession?: unknown;
  notes?: string | null;
  driverNotes?: string | null;
  handlingAssessmentJson?: unknown;
  carRating?: number | null;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
  warmerTimingMinutes?: number | null;
  tirePrep?: unknown;
  conditionsAirTempC?: number | null;
  conditionsTrackTempC?: number | null;
  conditionsCloudCoverPct?: number | null;
  conditionsWeatherCode?: number | null;
  conditionsHumidityPct?: number | null;
  conditionsWindKph?: number | null;
  car?: { name: string } | null;
  carNameSnapshot?: string | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
  tireType?: { displayName: string } | null;
  additiveType?: { displayName: string } | null;
  event?: { name: string } | null;
};

export type BuildShareCardParams = {
  run: ShareRunInput;
  style: ShareCardStyle;
  sections: ShareSections;
  /** Already formatted in the viewer's zone by the caller — this module never touches time zones. */
  dateTimeLabel: string;
  /** The same instant, for the Hero masthead's `SAT 8 AUG 2026` stamp. */
  dateStamp?: string | null;
  /** Owner's display name — always on the picture, whatever is toggled off. */
  driverName?: string | null;
  /** This run's setup and the previous run's on the same car, for the diff. */
  setupData?: unknown;
  previousSetupData?: unknown;
  /** The sharer's units, for the air temperature and the warmers. Metric when omitted. */
  units?: UnitSystem;
  /** Where the trace will be drawn. The long picture's {@link TRACE} when omitted. */
  traceBox?: ShareTraceBox;
};

const MEETING_LABELS: Record<string, string> = {
  PRACTICE: "Practice",
  SEEDING: "Seeding",
  QUALIFYING: "Qualifying",
  RACE: "Race",
  OTHER: "Other",
};

/**
 * Same fall-back chain as `resolveTirePrepSteps` in `TirePrepStepsList` — stored steps first, a
 * reconstruction from the legacy warmer column second. Rebuilt from the two primitives rather
 * than imported, because that helper lives in a `.tsx` component file and this module has to stay
 * free of React to be testable.
 *
 * One line per step: the card gives this cell two mono lines, the way the session view does.
 */
function tirePrepLines(run: ShareRunInput, units: UnitSystem): string[] {
  const stored = normalizeTirePrep(run.tirePrep);
  const steps: TirePrepStep[] =
    stored.length > 0
      ? stored
      : tirePrepFromLegacy(run.warmerTimingMinutes ?? null, Boolean(run.additiveType));
  if (steps.length === 0) return ["—"];
  return steps.map((s: TirePrepStep) => {
    const bits: string[] = [];
    if (s.minutes != null && s.minutes > 0) bits.push(`${s.minutes}m`);
    bits.push(s.appliedAdditive ? "additive" : "no sauce");
    if (s.warmers) {
      bits.push(
        `warmers${s.temperatureC != null ? ` ${formatWarmerTemp(s.temperatureC, units, { bare: true })}` : ""}`
      );
    }
    // A real separator: satori collapses runs of spaces, so padding would not hold.
    return bits.join(" · ");
  });
}

/**
 * The trace, as the on-screen `LapTimeGraph` draws it, scaled into {@link TRACE}.
 *
 * **Slower plots HIGHER.** That is the app's own direction, not a preference: `LapTimeGraph`
 * computes `y = padTop + ((hi - value) / (hi - lo)) * innerHeight`, and since SVG y grows downward
 * that puts the slowest lap at the top. A card that inverted it would disagree with the screen it
 * came from, which is worse than either convention on its own.
 *
 * The window is the session's own clean-pace spread (best → slowest inside best × 1.15, 8%
 * padding), never zero-based — a 15.1 next to a 16.4 is the whole story, and a zero-based axis
 * would flatten it into one grey line. Laps past the ceiling pin to the top edge and are marked
 * `clamped`, exactly as the on-screen graph marks them with a triangle.
 */
function traceFromLaps(
  rows: LapRow[],
  best: Set<number>,
  miss: Set<number>,
  box: ShareTraceBox
): ShareTrace | null {
  if (rows.length < 3) return null;
  const included = rows.filter((r) => r.isIncluded !== false).map((r) => r.lapTimeSeconds);
  const anchor = included.length > 0 ? included : rows.map((r) => r.lapTimeSeconds);
  const fastest = Math.min(...anchor);
  const cap = fastest * CLAMP_FACTOR;
  const inWindow = included.filter((t) => t <= cap);
  let min = fastest;
  let max = inWindow.length > 0 ? Math.max(...inWindow) : cap;
  const anyClamped = included.some((t) => t > cap);
  if (anyClamped) max = Math.max(max, cap);
  if (max - min < 0.4) {
    // Metronomic run — pad so the line doesn't collapse flat.
    const mid = (min + max) / 2;
    min = mid - 0.2;
    max = mid + 0.2;
  }
  const padding = (max - min) * 0.08;
  const lo = min - padding;
  const hi = max + padding;

  const innerWidth = box.width - box.padLeft - box.padRight;
  const innerHeight = box.height - box.padTop - box.padBottom;
  const n = rows.length;
  const round = (v: number) => Math.round(v * 10) / 10;
  const xAt = (i: number) =>
    round(box.padLeft + (n === 1 ? innerWidth / 2 : (i / (n - 1)) * innerWidth));
  const yAt = (v: number) =>
    round(box.padTop + ((hi - Math.min(v, hi)) / (hi - lo)) * innerHeight);

  const plotted = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.isIncluded !== false);
  if (plotted.length < 2) return null;

  const dots: ShareTraceDot[] = plotted.map(({ r, i }) => ({
    x: xAt(i),
    y: yAt(r.lapTimeSeconds),
    flag: best.has(r.lapNumber) ? "best" : miss.has(r.lapNumber) ? "miss" : null,
    clamped: anyClamped && r.lapTimeSeconds > cap,
  }));

  const gridlines = [lo + (hi - lo) * 0.12, (lo + hi) / 2, hi - (hi - lo) * 0.12].map((tick) => ({
    y: yAt(tick),
    // Mono digits sit on their own baseline; nudge the label to the line's optical centre.
    labelY: round(yAt(tick) + 7),
    label: tick.toFixed(1),
  }));

  // Every third lap, plus the last one, so the axis never ends on a bare tick. A regular label
  // that lands right beside the last one gives way to it: 20 laps put "19" and "20" in one slot.
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => i === n - 1 || (i % step === 0 && n - 1 - i >= Math.ceil(step / 2)))
    .map(({ r, i }) => ({ x: xAt(i), label: String(r.lapNumber) }));

  return {
    points: dots.map((d) => `${d.x},${d.y}`).join(" "),
    dots,
    gridlines,
    xLabels,
  };
}

/**
 * The problem poles, in capture order — the same list `HandlingAssessmentFields` builds for its
 * tiles, rebuilt from the shared metadata rather than imported (that file is a client component).
 */
const NOTABLE_POLES: { axis: (typeof CAPTURE_TRAIT_AXIS_KEYS)[number]; sign: -1 | 1; label: string }[] =
  CAPTURE_TRAIT_AXIS_KEYS.flatMap((axis) =>
    HANDLING_TRAIT_CHIP_META[axis].problemPoles.map((pole) => ({
      axis,
      sign: pole.sign,
      label: pole.label,
    }))
  );

function feelFromRun(run: ShareRunInput): ShareFeel | null {
  const ratingRaw = run.carRating;
  const rating =
    typeof ratingRaw === "number" && ratingRaw >= 1 && ratingRaw <= 10 ? Math.round(ratingRaw) : null;
  const bandCaption = rating == null ? null : carRatingBandCaption(rating);

  const ui = uiStateFromParsed(parseHandlingAssessmentJson(run.handlingAssessmentJson));

  // Only answered phases are drawn — an empty row in a stored record is not information.
  const balanceRows: ShareBalanceRow[] = [];
  if (ui.balanceEntry != null) balanceRows.push({ label: "Entry", value: ui.balanceEntry });
  if (ui.balanceMid != null) balanceRows.push({ label: "Mid", value: ui.balanceMid });
  if (ui.balanceExit != null) balanceRows.push({ label: "Exit", value: ui.balanceExit });

  const notables: ShareNotable[] = NOTABLE_POLES.map((pole) => {
    const value = ui[pole.axis];
    const severity =
      value != null && value !== 0 && Math.sign(value) === pole.sign
        ? (Math.abs(value) as 1 | 2 | 3)
        : null;
    return { label: pole.label, severity };
  });
  const anyNotableFlagged = notables.some((n) => n.severity != null);

  // Nothing was answered anywhere: draw no block rather than an empty instrument.
  if (rating == null && balanceRows.length === 0 && !anyNotableFlagged) return null;

  return {
    rating,
    bandCaption,
    bands: CAR_RATING_BANDS.map((b) => ({
      caption: b.caption,
      ratings: [...b.ratings],
      active: bandCaption === b.caption,
    })),
    balance: balanceRows.length > 0 ? balanceRows : null,
    // Kept even when none are flagged, as long as something else was answered: the unflagged
    // tiles are the record of what was considered and dismissed.
    notables,
  };
}

export function buildShareRunCard(params: BuildShareCardParams): ShareRunCard {
  const { run, style, sections } = params;
  const report = style === "report";

  const lapRows = primaryLapRowsFromRun({ lapTimes: run.lapTimes, lapSession: run.lapSession });
  const dash = getIncludedLapDashboardMetrics(lapRows);
  const mistakes = computeMistakeLaps(lapRows);

  const missNumbers = new Set(mistakes.mistakes.map((m) => m.lapNumber));
  const bestNumbers = new Set<number>();
  if (dash.bestLap != null) {
    for (const l of lapRows) {
      if (l.isIncluded !== false && Math.abs(l.lapTimeSeconds - dash.bestLap) <= 0.0005) {
        bestNumbers.add(l.lapNumber);
      }
    }
  }

  const carName = run.car?.name ?? run.carNameSnapshot ?? "Deleted car";
  const trackName = run.track?.name ?? run.trackNameSnapshot ?? null;
  const units = params.units ?? "metric";
  const conditionsChip = formatConditionsChip(runConditionsFromRecord(run), units);
  const title = formatRunSessionDisplay(run, { fallback: "Testing run" });
  const eventName = run.event?.name ?? null;
  const driverName = params.driverName?.trim() || null;

  // `Laps / time` is a headline figure, not a timing read: `19 / 4:55`, never `19 / 4:55.000`.
  // The thousandths still travel — they are the `Stint` well, two blocks down.
  const lapsTime =
    dash.stintSeconds != null
      ? `${dash.lapCount} / ${formatStintTime(dash.stintSeconds).replace(/\.\d+$/, "")}`
      : String(dash.lapCount);

  const tiles: ShareTile[] = [
    { label: "Best lap", value: formatLap(dash.bestLap), mono: true },
    { label: "Avg top 5", value: formatLap(dash.avgTop5), mono: true },
    { label: "Avg top 10", value: formatLap(dash.avgTop10), mono: true },
    { label: "Laps / time", value: lapsTime, mono: true },
  ];

  const details: ShareWell[] =
    report && sections.details
      ? [
          { label: "Date / time", value: params.dateTimeLabel },
          {
            label: "Session",
            value:
              run.meetingSessionType === "OTHER" && run.meetingSessionCode?.trim()
                ? run.meetingSessionCode.trim()
                : run.meetingSessionType
                  ? MEETING_LABELS[run.meetingSessionType] ?? run.meetingSessionType
                  : "—",
          },
          { label: "Car", value: carName },
          {
            label: "Tire set",
            value: run.tireType
              ? `${run.tireType.displayName} · run ${run.tireRunNumber ?? "?"}${
                  run.tireAgeKnown === false ? " (age unknown)" : ""
                }`
              : "—",
          },
          { label: "Additive", value: run.additiveType?.displayName ?? "—" },
          { label: "Tire prep", value: "", mono: true, lines: tirePrepLines(run, units) },
        ]
      : [];

  const lapWells: ShareWell[] = report
    ? [
        { label: "Laps", value: String(dash.lapCount) },
        {
          label: "Stint",
          value: dash.stintSeconds != null ? formatStintTime(dash.stintSeconds) : "—",
          mono: true,
        },
        { label: "Best lap", value: formatLap(dash.bestLap), mono: true },
        { label: "Avg top 5", value: formatLap(dash.avgTop5), mono: true },
        { label: "Avg top 10", value: formatLap(dash.avgTop10), mono: true },
        { label: "Median", value: formatLap(dash.median), mono: true },
        { label: "Cond.", value: conditionsChip?.value ?? "—" },
        {
          label: "Consist.",
          value:
            dash.consistencyScore != null ? formatConsistencyScorePercent(dash.consistencyScore) : "—",
          mono: true,
        },
        { label: "Mistakes", value: mistakes.eligible ? String(mistakes.mistakeCount) : "—" },
      ]
    : [];

  const laps: ShareLap[] | null =
    sections.laps && lapRows.length > 0
      ? lapRows.map((r) => ({
          lapNumber: r.lapNumber,
          time: r.lapTimeSeconds.toFixed(3),
          flag: bestNumbers.has(r.lapNumber) ? "best" : missNumbers.has(r.lapNumber) ? "miss" : null,
          excluded: r.isIncluded === false,
        }))
      : null;

  const trace = sections.graph
    ? traceFromLaps(lapRows, bestNumbers, missNumbers, params.traceBox ?? TRACE)
    : null;

  const changed =
    sections.setup && params.previousSetupData != null
      ? setupChangedRowsSincePrevious(params.setupData, params.previousSetupData).map((r) => ({
          label: r.label,
          from: r.previousValue,
          to: r.value,
        }))
      : null;

  const notesText = (run.notes?.trim() || run.driverNotes?.trim() || "") || null;
  const notes = sections.notes ? notesText : null;

  const feel = sections.feel ? feelFromRun(run) : null;

  const card: ShareRunCard = {
    style,
    dateStamp: params.dateStamp?.trim() || params.dateTimeLabel,
    eyebrow: eventName ?? "",
    title,
    driverName,
    trackName,
    carName,
    eventName,
    tiles,
    details,
    lapWells,
    laps,
    trace,
    changed: changed && changed.length > 0 ? changed : null,
    notes,
    feel,
  };
  return card;
}

// ---------------------------------------------------------------------------
// Is there anything worth sending?
// ---------------------------------------------------------------------------

/**
 * Strava refuses to share an activity it can't draw a map for. Same rule: a run with no laps
 * and no drawable setup has nothing on its picture but a title, so no Share button is offered.
 */
export function runIsShareable(run: { lapTimes: unknown; lapSession?: unknown }, hasSetup: boolean): boolean {
  if (hasSetup) return true;
  return primaryLapRowsFromRun(run).length > 0;
}

/** Laps to draw: the story leads with a best lap, so a run without any is not offered one. */
export function runHasLaps(run: { lapTimes: unknown; lapSession?: unknown }): boolean {
  return primaryLapRowsFromRun(run).length > 0;
}
