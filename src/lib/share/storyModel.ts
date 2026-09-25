/**
 * What goes on a story picture — decided here, drawn by `storyLooks.tsx`.
 *
 * Pure like `shareCardModel.ts`: no React, no Prisma, testable without a font (`npm run test:share`).
 *
 * The content is the founder's own mix from the share interview (round 2, 2026-09-25): the driver's
 * name biggest, finishing place, best lap, laps and time, pace against the field, the lap chart,
 * the event, consistency, and a "Logged with" line. Nothing on a story is chip-controlled: the
 * driver chooses a LOOK (A–D, round 3), not what is on it.
 */

import {
  computeMistakeLaps,
  getIncludedLapDashboardMetrics,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { formatLap, formatStintTime } from "@/lib/runLaps";
import { formatRunSessionDisplay } from "@/lib/runSession";

/**
 * The four looks, after the Arccos posts the founder sent (round 3). Drivers pick; C is the default
 * ("my favourite is C i think").
 *   A — the driver's photo full-bleed, the numbers on a frosted panel.
 *   B — the photo framed on paper, the result huge across it.
 *   C — the photo fading into mist, the numbers huge in gold.
 *   D — no photo: a designed dark backdrop, A's layout.
 * Without a photo, A draws as D and B / C draw a designed backdrop in the photo's place ("their
 * photo if they add one, our design if not").
 */
export type StoryLook = "A" | "B" | "C" | "D";
export const STORY_LOOKS: readonly StoryLook[] = ["C", "A", "B", "D"];
export const DEFAULT_STORY_LOOK: StoryLook = "C";

/** 9:16 for stories; the same look at 4:5 for feed posts and groups (founder left sizes to me). */
export type StoryFrame = "story" | "post";

export function parseStoryLook(raw: string | null | undefined): StoryLook {
  return raw === "A" || raw === "B" || raw === "C" || raw === "D" ? raw : DEFAULT_STORY_LOOK;
}

export function parseStoryFrame(raw: string | null | undefined): StoryFrame {
  return raw === "post" ? "post" : "story";
}

/** Clean-pace ceiling, the same as `LapTimeGraph` and the long picture: slower laps pin to the top. */
const CLAMP_FACTOR = 1.15;

export type StoryLap = { lap: number; seconds: number; flag: "best" | "miss" | null };

export type StoryTrace = {
  /** Included laps only, in lap order; excluded laps leave a gap the line bridges. */
  laps: StoryLap[];
  /** Laps slower than this pin to the chart's top edge, marked, as the app's own graph does. */
  ceiling: number;
};

export type StoryData = {
  /** The headline. The account name, else the name on the timing sheet, else null. */
  driver: string | null;
  event: string | null;
  /** `Race`, `Qualifying`, `Testing run` — the session in the app's display voice. */
  session: string;
  track: string | null;
  car: string;
  /** `SUN 28 JUN 2026`. */
  dateStamp: string;
  best: string | null;
  lapCount: number;
  /** `4:50`, the stint without its thousandths. */
  time: string | null;
  consistency: string | null;
  finish: { position: number; of: number } | null;
  /** Seconds a lap, you minus the field. Negative is faster. */
  paceVsField: number | null;
  fieldAveragePace: number | null;
  trace: StoryTrace | null;
};

export type StoryRunInput = {
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  lapTimes: unknown;
  lapSession?: unknown;
  car?: { name: string } | null;
  carNameSnapshot?: string | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
  event?: { name: string } | null;
};

export type StoryField = {
  position: number;
  fieldSize: number;
  paceVsField: number | null;
  fieldAveragePace: number | null;
  timingName: string | null;
};

/**
 * `JORDAN CARUSO` → `Jordan Caruso`. Timing sheets print names in capitals; the story sets the
 * headline in capitals anyway, but the account name is stored as the driver typed it.
 */
export function titleCaseName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function buildStoryData(params: {
  run: StoryRunInput;
  dateStamp: string;
  accountName?: string | null;
  field?: StoryField | null;
  /** The name on the run's own timing import, for a run with no field to read it from. */
  timingName?: string | null;
}): StoryData {
  const { run, field } = params;
  const rows = primaryLapRowsFromRun({ lapTimes: run.lapTimes, lapSession: run.lapSession });
  const dash = getIncludedLapDashboardMetrics(rows);
  const mistakes = new Set(computeMistakeLaps(rows).mistakes.map((m) => m.lapNumber));

  const included = rows.filter((r) => r.isIncluded !== false);
  let trace: StoryTrace | null = null;
  if (included.length >= 3 && dash.bestLap != null) {
    const best = dash.bestLap;
    trace = {
      laps: included.map((r) => ({
        lap: r.lapNumber,
        seconds: r.lapTimeSeconds,
        flag: Math.abs(r.lapTimeSeconds - best) <= 0.0005 ? "best" : mistakes.has(r.lapNumber) ? "miss" : null,
      })),
      ceiling: best * CLAMP_FACTOR,
    };
  }

  const account = params.accountName?.trim();
  const timing = field?.timingName?.trim() || params.timingName?.trim();
  return {
    driver: account ? account : timing ? titleCaseName(timing) : null,
    event: run.event?.name?.trim() || null,
    session: formatRunSessionDisplay(run, { fallback: "Testing run" }),
    track: run.track?.name ?? run.trackNameSnapshot ?? null,
    car: run.car?.name ?? run.carNameSnapshot ?? "Deleted car",
    dateStamp: params.dateStamp,
    best: dash.bestLap != null ? formatLap(dash.bestLap) : null,
    lapCount: dash.lapCount,
    time: dash.stintSeconds != null ? formatStintTime(dash.stintSeconds).replace(/\.\d+$/, "") : null,
    // One decimal: `98.9%` on a poster, where the app's own two decimals read as noise.
    consistency: dash.consistencyScore != null ? `${dash.consistencyScore.toFixed(1)}%` : null,
    finish: field ? { position: field.position, of: field.fieldSize } : null,
    paceVsField: field?.paceVsField ?? null,
    fieldAveragePace: field?.fieldAveragePace ?? null,
    trace,
  };
}

/** `1` → `1st`. */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

/** `−0.333`, with a real minus sign; `+0.120` when slower. */
export function formatPaceGap(seconds: number): string {
  return (seconds < 0 ? "−" : "+") + Math.abs(seconds).toFixed(3);
}
