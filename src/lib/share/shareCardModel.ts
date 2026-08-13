/**
 * What goes on a shared picture — decided here, drawn elsewhere.
 *
 * Pure on purpose: no React, no `server-only`, no Prisma. The renderer
 * (`renderRunCard.tsx`) turns this into pixels and nothing else; every question of *what* a
 * driver is about to publish is answered in this file, where it can be unit-tested without a
 * font, a browser, or a database (`npm run test:share`).
 *
 * The card IS the expanded session view minus the video panel (founder ruling 2026-08-13, the
 * share redesign). There is no longer a headline/full split: the driver picks a STYLE —
 *
 *   hero   — leads with the best lap, for a story or a group chat thumbnail.
 *   report — leads with session identity, for the team chat.
 *
 * — and ticks which blocks travel. Nothing overrides anything: a chip is the only thing that
 * turns a block on or off, which was the whole complaint about the old modes (they silently
 * reset the section flags underneath the driver).
 *
 * Some things are never chip-controlled and must survive every combination: best lap, avg top 5,
 * avg top 10, laps & stint, track, date, driver name, and the JRC mark.
 *
 * It also owns the card's HEIGHT. Satori lays out into a fixed box and clips whatever
 * overflows, so the height has to be known before a single pixel is drawn — see
 * `estimateCardHeight`. Every measurement in here is in final image pixels at
 * {@link CARD_WIDTH}, which is why the numbers look large.
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
import { normalizeTirePrep, tirePrepFromLegacy, type TirePrepStep } from "@/lib/runs/tirePrep";

/** Final image width. Everything below is measured against it. */
export const CARD_WIDTH = 1080;
const PAD = 56;
const INNER = CARD_WIDTH - PAD * 2;

/** Lap chips per row. Shared with the renderer so the height estimate can't disagree with it. */
export const LAP_CHIPS_PER_ROW = 6;

/** The trace's own box, in card pixels. Mirrors `LapTimeGraph`'s geometry at 2.9× scale. */
export const TRACE = {
  width: INNER,
  height: 300,
  padLeft: 72,
  padRight: 20,
  padTop: 24,
  padBottom: 44,
} as const;

/** Clean-pace ceiling, copied from `LapTimeGraph`: laps slower than best × this clamp to the top. */
const CLAMP_FACTOR = 1.15;

export type ShareCardStyle = "hero" | "report";

export function parseCardStyle(raw: string | null | undefined): ShareCardStyle {
  return raw === "report" ? "report" : "hero";
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
  /** Hero: the driver, on their own line, big. Null when the run has no owner name. */
  driverName: string | null;
  /** Hero: two lines under the driver name. Gated by the `details` chip. */
  heroLines: string[];
  /** Report: `track · car · driver`, under the title. */
  subtitle: string;
  /** Report: the four-up headline well. Hero: the last three, as a strip. Always present. */
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
  /** Computed last, from everything above. */
  height: number;
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
function tirePrepLines(run: ShareRunInput): string[] {
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
    if (s.warmers) bits.push(`warmers${s.temperatureC != null ? ` ${s.temperatureC}°` : ""}`);
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
  miss: Set<number>
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

  const innerWidth = TRACE.width - TRACE.padLeft - TRACE.padRight;
  const innerHeight = TRACE.height - TRACE.padTop - TRACE.padBottom;
  const n = rows.length;
  const round = (v: number) => Math.round(v * 10) / 10;
  const xAt = (i: number) =>
    round(TRACE.padLeft + (n === 1 ? innerWidth / 2 : (i / (n - 1)) * innerWidth));
  const yAt = (v: number) =>
    round(TRACE.padTop + ((hi - Math.min(v, hi)) / (hi - lo)) * innerHeight);

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

  // Every third lap, plus the last one, so the axis never ends on a bare tick.
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = rows
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => i % step === 0 || i === n - 1)
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
  const conditionsChip = formatConditionsChip(runConditionsFromRecord(run));
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

  // Hero: two ink-2 lines under the driver's name, the session's identity in prose.
  const heroLines = sections.details
    ? ([[title, eventName].filter(Boolean).join(" · "), [trackName, carName].filter(Boolean).join(" · ")]
        .filter((l) => l.length > 0) as string[])
    : [];

  const subtitle = [trackName, carName, driverName].filter(Boolean).join(" · ");

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
          { label: "Tire prep", value: "", mono: true, lines: tirePrepLines(run) },
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

  const trace = sections.graph ? traceFromLaps(lapRows, bestNumbers, missNumbers) : null;

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
    heroLines,
    subtitle,
    tiles,
    details,
    lapWells,
    laps,
    trace,
    changed: changed && changed.length > 0 ? changed : null,
    notes,
    feel,
    height: 0,
  };
  card.height = estimateCardHeight(card);
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

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

/*
 * Block heights in final pixels. These MUST track `renderRunCard.tsx` — a change to a font
 * size or a padding there without a change here means the card silently clips its own footer.
 * `npm run test:share` pins the arithmetic; only a rendered card proves the constants.
 */
const H = {
  /** Report masthead: 44px padding, a 44px mark, 44px padding, 1px rule. */
  masthead: 133,
  /** Report title block: 48 top pad + 22 eyebrow + 16 + title + 18 rule + 16 + subtitle lines. */
  reportTitleTop: 48 + 22 + 16,
  reportTitleLine: 84,
  reportTitleRule: 18,
  reportSubtitleTop: 16,
  reportSubtitleLine: 42,
  /** Report headline well: 40 margin + its 1px frame + 24px padding either side of a 92px cell. */
  reportHeadline: 40 + 2 + 48 + 92,

  /** Hero block: 56 pad, masthead 52, 60 gap, 145 figure, 16 + 6 cut, 40 + name, lines, 56 pad. */
  heroTop: 56 + 52 + 60,
  heroFigure: 145,
  heroCut: 22,
  heroNameTop: 40,
  heroNameLine: 60,
  heroLine: 46,
  heroBottom: 56,
  /** Hero's 3-up strip: 64px of padding around a 104px cell, plus the 1px rule under it. */
  heroStrip: 64 + 104 + 1,

  /** A section heading: 48 top padding + 30 tick + 20 margin. */
  section: 98,
  /** One instrument-well row: 18 pad + 37 value + 18 pad + 1px seam. */
  wellRow: 74,
  /** Tire prep spends a second mono line. */
  wellRowExtra: 34,
  /** One lap-chip row at 23px/1.35 with the well's 8px row gap. */
  lapRow: 39,
  /** The lap well's own 20/16 padding, plus its 18px top margin. */
  lapsPad: 58,
  /** The trace SVG plus its 22px top margin and the legend under it. */
  trace: 22 + TRACE.height,
  legend: 8 + 20,
  /** Setup diff: a 48px header band, then one row each. */
  diffHead: 48,
  diffRow: 62,
  /** Notes at 30px/1.6. */
  notesLine: 48,
  /** Feel: the rating label, then the band blocks and their captions (72 + 8 + 27). */
  feelLabel: 29,
  feelBands: 18 + 107,
  /** The corner-balance panel: 36 margin + 26 top padding + its own border. */
  feelPanelTop: 36 + 26 + 1,
  /** Each instrument inside it is labelled: a 29px line and 16px of air. */
  feelPanelLabel: 29 + 16,
  /** Its header band: a 24px line inside 14px of padding, plus the rule under it. */
  feelBalanceHead: 24 + 28 + 1,
  /** One phase: a reserved 24px word, 8px, a 31px staircase, 28px of padding, and the 1px seam. */
  feelBalanceRow: 24 + 8 + 31 + 28 + 1,
  /** The gap between the balance instrument and the notable tiles. */
  feelPanelGap: 28,
  /** A notable tile: 29px label, 16px, a 22px staircase, 40px of padding, 2px border, 12px gutter. */
  feelNotableRow: 29 + 16 + 22 + 40 + 2 + 12,
  feelPanelBottom: 26 + 1,
  /** Footer: 48 margin, 1px rule, 44 + 38 + 44. */
  footer: 175,
  /*
   * Wrapping is estimated from average glyph width, so a long word can push one line further than
   * predicted. Slack absorbs that; without it the overflow lands on the footer.
   *
   * 44px is deliberately a hair more than one wrapped line of the largest wrapping text on the
   * card (the 30px notes and subtitle, 42–48px a line). `scripts/dev-share-card-fit.ts` measures
   * what every block really costs; with these constants it reports 16–34px of spare ground, so
   * the slack is the only thing standing between a mis-predicted line and a lost footer.
   */
  slack: 44,
} as const;

/** Rough line count for text laid out at `fontSize` across `width`. */
export function wrappedLines(text: string, fontSize: number, width: number): number {
  if (!text) return 0;
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.52)));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    lines += Math.max(1, Math.ceil(paragraph.length / perLine));
  }
  return lines;
}

/**
 * The lap chips and the trace, without any section heading of their own.
 *
 * They share one block because that is how the renderer draws them: in Report they sit under the
 * `Laptimes` heading with the nine figures, in Hero under a single heading of their own. The
 * legend belongs to the pair, so it is counted once when either is present.
 */
function lapBlockHeight(card: ShareRunCard): number {
  let h = 0;
  if (card.laps) {
    h += Math.ceil(card.laps.length / LAP_CHIPS_PER_ROW) * H.lapRow + H.lapsPad;
  }
  if (card.trace) h += H.trace;
  if (card.laps || card.trace) h += H.legend;
  return h;
}

/** Everything below the lap block, in the order the renderer draws it. Shared by both styles. */
function sharedSectionsHeight(card: ShareRunCard): number {
  let h = 0;

  if (card.changed) h += H.section + H.diffHead + card.changed.length * H.diffRow;

  if (card.notes) h += H.section + wrappedLines(card.notes, 30, INNER) * H.notesLine;

  if (card.feel) {
    h += H.section + H.feelLabel + H.feelBands;
    const hasBalance = card.feel.balance != null;
    const hasNotables = card.feel.notables.length > 0;
    if (hasBalance || hasNotables) {
      h += H.feelPanelTop + H.feelPanelBottom;
      if (hasBalance) {
        h +=
          H.feelPanelLabel + H.feelBalanceHead + card.feel.balance!.length * H.feelBalanceRow + 2;
      }
      if (hasNotables) {
        h +=
          (hasBalance ? H.feelPanelGap : 0) +
          H.feelPanelLabel +
          Math.ceil(card.feel.notables.length / 2) * H.feelNotableRow;
      }
    }
  }

  return h;
}

export function estimateCardHeight(card: ShareRunCard): number {
  let h = 0;

  if (card.style === "report") {
    h += H.masthead;
    h += H.reportTitleTop;
    h += wrappedLines(card.title, 76, INNER) * H.reportTitleLine;
    h += H.reportTitleRule;
    h += card.subtitle
      ? H.reportSubtitleTop + wrappedLines(card.subtitle, 30, INNER) * H.reportSubtitleLine
      : 0;
    h += H.reportHeadline;
    if (card.details.length > 0) {
      const rows = Math.ceil(card.details.length / 2);
      h += H.section + rows * H.wellRow + H.wellRowExtra;
    }
    // `Laptimes` always shows the nine figures, and carries the chips and trace under its heading.
    h += H.section + Math.ceil(card.lapWells.length / 3) * H.wellRow + lapBlockHeight(card);
  } else {
    h += H.heroTop;
    h += H.heroFigure;
    h += H.heroCut;
    h += card.driverName ? H.heroNameTop + H.heroNameLine : 0;
    h += card.heroLines.reduce(
      (acc, line) => acc + wrappedLines(line, 32, INNER) * H.heroLine,
      card.heroLines.length > 0 ? 12 : 0
    );
    h += H.heroBottom;
    h += H.heroStrip;
    // One heading over the chips and the trace, whichever of them is on.
    if (card.laps || card.trace) h += H.section + lapBlockHeight(card);
  }

  h += sharedSectionsHeight(card);

  return h + H.footer + H.slack;
}
