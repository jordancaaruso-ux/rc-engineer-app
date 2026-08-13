/**
 * What goes on a shared picture — decided here, drawn elsewhere.
 *
 * Pure on purpose: no React, no `server-only`, no Prisma. The renderer
 * (`renderRunCard.tsx`) turns this into pixels and nothing else; every question of *what* a
 * driver is about to publish is answered in this file, where it can be unit-tested without a
 * font, a browser, or a database (`npm run test:share`).
 *
 * Two shapes, per the founder ruling 2026-08-13:
 *   headline — four figures (best, avg top 5, avg top 10, laps/time) and little else.
 *   full     — everything the expanded session view shows, minus the app's own furniture
 *              (the video compare panel, the edit and delete buttons).
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
  HANDLING_TRAIT_AXIS_UI,
  parseHandlingAssessmentJson,
  uiStateFromParsed,
} from "@/lib/runHandlingAssessment";
import { normalizeTirePrep, tirePrepFromLegacy, type TirePrepStep } from "@/lib/runs/tirePrep";

/** Final image width. Everything below is measured against it. */
export const CARD_WIDTH = 1080;
const PAD = 56;
const INNER = CARD_WIDTH - PAD * 2;

/** Lap chips per row. Shared with the renderer so the height estimate can't disagree with it. */
export const LAP_CHIPS_PER_ROW = 6;

export type ShareMode = "headline" | "full";

/** The tickable extras. `setup` is not here — it is a second picture, not a section. */
export type ShareSectionKey = "pace" | "laps" | "graph" | "notes";

export const SHARE_SECTION_KEYS: readonly ShareSectionKey[] = ["pace", "laps", "graph", "notes"];

export type ShareSections = Record<ShareSectionKey, boolean>;

/**
 * Full run IS the expanded session view, so choosing it turns everything on; headline turns
 * everything off. Either can then be overridden a chip at a time — this only supplies the
 * starting point when the mode changes.
 */
export function defaultSectionsForMode(mode: ShareMode): ShareSections {
  const on = mode === "full";
  return { pace: false, laps: on, graph: on, notes: on };
}

/** `?sections=laps,graph` → flags. Unknown names are ignored, never an error. */
export function parseSectionsParam(raw: string | null | undefined): ShareSections {
  const wanted = new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return {
    pace: wanted.has("pace"),
    laps: wanted.has("laps"),
    graph: wanted.has("graph"),
    notes: wanted.has("notes"),
  };
}

export function serializeSections(s: ShareSections): string {
  return SHARE_SECTION_KEYS.filter((k) => s[k]).join(",");
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ShareTile = { label: string; value: string; suffix?: string };
export type ShareWell = { label: string; value: string };
export type ShareLap = { lapNumber: number; time: string; flag: "best" | "miss" | null; excluded: boolean };
/** `heightPct` is proportional to lap TIME: taller = slower. See `barsFromLaps`. */
export type ShareBar = { heightPct: number; flag: "best" | "miss" | null };
export type ShareDiffRow = { label: string; from: string; to: string };
export type ShareTrait = { label: string; neg: string; pos: string; /** −3…+3 */ value: number };

export type ShareRunCard = {
  mode: ShareMode;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Best lap, avg top 5, avg top 10, laps/time — always four, always in this order. */
  tiles: ShareTile[];
  /** Full-width fifth tile. Null unless the pace chip is on and a field comparison exists. */
  pace: { label: string; value: string; note: string; faster: boolean } | null;
  /** Headline only: the one-line conditions strip. */
  conditionsLine: string | null;
  /** Full only. */
  details: ShareWell[];
  lapWells: ShareWell[];
  laps: ShareLap[] | null;
  bars: ShareBar[] | null;
  changed: ShareDiffRow[] | null;
  notes: string | null;
  rating: number | null;
  traits: ShareTrait[] | null;
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
  mode: ShareMode;
  sections: ShareSections;
  /** Already formatted in the viewer's zone by the caller — this module never touches time zones. */
  dateTimeLabel: string;
  /** Owner's display name. Full mode only; headline stays anonymous-ish. */
  driverName?: string | null;
  /** This run's setup and the previous run's on the same car, for the diff. */
  setupData?: unknown;
  previousSetupData?: unknown;
  /** Seconds per lap: this driver's average minus the field's. Negative = faster. */
  paceVsFieldSeconds?: number | null;
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
 */
function tirePrepSummary(run: ShareRunInput): string {
  const stored = normalizeTirePrep(run.tirePrep);
  const steps: TirePrepStep[] =
    stored.length > 0
      ? stored
      : tirePrepFromLegacy(run.warmerTimingMinutes ?? null, Boolean(run.additiveType));
  if (steps.length === 0) return "—";
  return steps
    .map((s: TirePrepStep) => {
      const bits: string[] = [];
      if (s.minutes != null && s.minutes > 0) bits.push(`${s.minutes}m`);
      bits.push(s.appliedAdditive ? "additive" : "no sauce");
      if (s.warmers) bits.push(`warmers${s.temperatureC != null ? ` ${s.temperatureC}°` : ""}`);
      return bits.join(" ");
    })
    .join(" → ");
}

/**
 * Bar per lap. **Taller is SLOWER** — the bar is how long the lap took.
 *
 * This is the app's own direction, not a preference: `LapTimeGraph` plots
 * `y = PAD_TOP + ((hi - value) / (hi - lo)) * innerHeight`, and since SVG y grows downward that
 * puts the slowest lap at the top of the trace. A card that inverted it would disagree with the
 * screen it came from, which is worse than either convention on its own.
 *
 * Scaled against the session's own spread rather than zero — a 15.1 next to a 16.4 is the whole
 * story, and a zero-based axis would flatten it into one grey block.
 */
function barsFromLaps(rows: LapRow[], best: Set<number>, miss: Set<number>): ShareBar[] | null {
  const shown = rows.filter((r) => r.isIncluded !== false);
  if (shown.length < 3) return null;
  const times = shown.map((r) => r.lapTimeSeconds);
  const fastest = Math.min(...times);
  const slowest = Math.max(...times);
  const span = slowest - fastest || 1;
  return shown.map((r) => ({
    // Floor of 18% at the fastest lap so the best lap is still a visible bar, 100% at the slowest.
    heightPct: Math.round(18 + ((r.lapTimeSeconds - fastest) / span) * 82),
    flag: best.has(r.lapNumber) ? "best" : miss.has(r.lapNumber) ? "miss" : null,
  }));
}

export function buildShareRunCard(params: BuildShareCardParams): ShareRunCard {
  const { run, mode, sections } = params;
  const full = mode === "full";

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

  const eyebrowParts = [run.event?.name ?? null, params.dateTimeLabel].filter(Boolean) as string[];
  const subtitleParts = [trackName, carName, full ? params.driverName ?? null : null].filter(
    Boolean
  ) as string[];

  const tiles: ShareTile[] = [
    { label: "Best lap", value: formatLap(dash.bestLap) },
    { label: "Avg top 5", value: formatLap(dash.avgTop5) },
    { label: "Avg top 10", value: formatLap(dash.avgTop10) },
    {
      label: "Laps / time",
      value: String(dash.lapCount),
      suffix: dash.stintSeconds != null ? ` / ${formatStintTime(dash.stintSeconds)}` : undefined,
    },
  ];

  const paceSec = params.paceVsFieldSeconds;
  const pace =
    sections.pace && paceSec != null && Number.isFinite(paceSec)
      ? {
          label: "Pace vs field average",
          // Repo convention: user − field, so negative is the good one.
          value: `${paceSec < 0 ? "−" : "+"}${Math.abs(paceSec).toFixed(3)}`,
          note: paceSec < 0 ? " per lap — faster" : " per lap — slower",
          faster: paceSec < 0,
        }
      : null;

  const details: ShareWell[] = full
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
        { label: "Tire prep", value: tirePrepSummary(run) },
      ]
    : [];

  const lapWells: ShareWell[] = full
    ? [
        { label: "Laps", value: String(dash.lapCount) },
        { label: "Stint", value: dash.stintSeconds != null ? formatStintTime(dash.stintSeconds) : "—" },
        { label: "Best lap", value: formatLap(dash.bestLap) },
        { label: "Avg top 5", value: formatLap(dash.avgTop5) },
        { label: "Avg top 10", value: formatLap(dash.avgTop10) },
        { label: "Median", value: formatLap(dash.median) },
        { label: "Cond.", value: conditionsChip?.value ?? "—" },
        {
          label: "Consist.",
          value:
            dash.consistencyScore != null
              ? formatConsistencyScorePercent(dash.consistencyScore)
              : "—",
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

  const bars = sections.graph ? barsFromLaps(lapRows, bestNumbers, missNumbers) : null;

  const changed =
    full && params.previousSetupData != null
      ? setupChangedRowsSincePrevious(params.setupData, params.previousSetupData).map((r) => ({
          label: r.label,
          from: r.previousValue,
          to: r.value,
        }))
      : null;

  const notesText = (run.notes?.trim() || run.driverNotes?.trim() || "") || null;
  const notes = sections.notes ? notesText : null;

  const ratingRaw = run.carRating;
  const rating =
    sections.notes && typeof ratingRaw === "number" && ratingRaw >= 1 && ratingRaw <= 10
      ? Math.round(ratingRaw)
      : null;

  let traits: ShareTrait[] | null = null;
  if (sections.notes) {
    const ui = uiStateFromParsed(parseHandlingAssessmentJson(run.handlingAssessmentJson));
    const rows: ShareTrait[] = [];
    for (const key of CAPTURE_TRAIT_AXIS_KEYS) {
      const v = ui[key];
      if (v == null) continue;
      const meta = HANDLING_TRAIT_AXIS_UI[key];
      rows.push({ label: meta.title, neg: meta.neg, pos: meta.pos, value: v });
    }
    traits = rows.length > 0 ? rows : null;
  }

  const card: ShareRunCard = {
    mode,
    eyebrow: eyebrowParts.join(" · "),
    title: formatRunSessionDisplay(run, { fallback: "Testing run" }),
    subtitle: subtitleParts.join(" · "),
    tiles,
    pace,
    conditionsLine: full ? null : conditionsLineFrom(run),
    details,
    lapWells,
    laps,
    bars,
    changed: changed && changed.length > 0 ? changed : null,
    notes,
    rating,
    traits,
    height: 0,
  };
  card.height = estimateCardHeight(card);
  return card;
}

/** Separated by a real character: satori collapses runs of spaces, so padding won't hold. */
function conditionsLineFrom(run: ShareRunInput): string | null {
  const parts: string[] = [];
  if (run.conditionsAirTempC != null) parts.push(`Air ${Math.round(run.conditionsAirTempC)}°C`);
  if (run.conditionsTrackTempC != null) parts.push(`Track ${Math.round(run.conditionsTrackTempC)}°C`);
  if (run.conditionsWindKph != null) parts.push(`Wind ${Math.round(run.conditionsWindKph)} km/h`);
  if (run.conditionsHumidityPct != null) parts.push(`Humidity ${Math.round(run.conditionsHumidityPct)}%`);
  return parts.length > 0 ? parts.join(" · ") : null;
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
 * `share.test.ts` pins the arithmetic; only a rendered card proves the constants.
 */
const H = {
  headerTop: PAD,
  eyebrowLine: 30,
  titleLine: 64,
  subtitleLine: 40,
  headerBottom: 56,
  tileRow: 166,
  paceRow: 166,
  conditionsLine: 84,
  band: 52,
  wellRow: 92,
  wellsPad: 26,
  lapRow: 43,
  lapsPad: 46,
  bars: 228,
  diffRow: 66,
  diffPad: 28,
  notesLine: 46,
  notesPad: 68,
  rating: 76,
  traitRow: 82,
  traitsPad: 24,
  legend: 40,
  footer: 104,
  /* Wrapping is estimated from average glyph width, so a long word can push one line further
     than predicted. Slack absorbs that; without it the overflow lands on the footer. */
  slack: 24,
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

export function estimateCardHeight(card: ShareRunCard): number {
  let h = H.headerTop;

  h += card.eyebrow ? H.eyebrowLine : 0;
  h += wrappedLines(card.title, 52, INNER) * H.titleLine;
  h += card.subtitle ? wrappedLines(card.subtitle, 28, INNER) * H.subtitleLine : 0;
  h += H.headerBottom;

  h += Math.ceil(card.tiles.length / 2) * H.tileRow;
  if (card.pace) h += H.paceRow;

  if (card.conditionsLine) h += H.conditionsLine;

  if (card.details.length > 0) {
    h += H.band + Math.ceil(card.details.length / 2) * H.wellRow + H.wellsPad;
  }
  if (card.lapWells.length > 0) {
    h += H.band + Math.ceil(card.lapWells.length / 3) * H.wellRow + H.wellsPad;
  }

  if (card.laps) {
    h += H.band + Math.ceil(card.laps.length / LAP_CHIPS_PER_ROW) * H.lapRow + H.lapsPad + H.legend;
  }

  if (card.bars) h += H.band + H.bars;

  if (card.changed) h += H.band + card.changed.length * H.diffRow + H.diffPad;

  if (card.notes) {
    h += H.band + wrappedLines(card.notes, 30, INNER - 60) * H.notesLine + H.notesPad;
  }
  if (card.rating != null) h += H.band + H.rating;
  if (card.traits) h += card.traits.length * H.traitRow + H.traitsPad;

  return h + H.footer + H.slack;
}
