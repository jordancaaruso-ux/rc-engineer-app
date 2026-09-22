/**
 * LAPS — every lap of every driver in the timed sessions the driver was in, as the Engineer
 * reads them (founder call 2026-09-22: "the results and every lap time of every driver so that
 * it can interpret it with all the information that a person would have if they went through
 * and looked").
 *
 * Measured before building (production, the founder's busiest day — SA State Titles Saturday,
 * 15 sessions, 761 laps): about 5,400 characters, ~1,700 tokens. The KB alone is ~14K tokens, so
 * a whole day's laps is small change, and a three-day meeting is ~2,400 tokens.
 *
 * Under each driver's laps a few figures are worked out HERE, in code, from those same laps —
 * the model is bad at adding up 18 laps × 10 drivers in its head, and a confident wrong number
 * is worse than none. It still gets the raw laps: the lap they binned, the two-lap dip after a
 * marshal, are things a person reads off the list, and the figures cannot carry them.
 *
 * Facts only. Nothing here says how to read a session; a wrong answer is a wrong or missing
 * fact on this block (north star §5, "driver data ships as facts, never instructions").
 *
 * Pure: no server imports, so the tests feed it hand-made sessions.
 */

export type LapsDriver = {
  name: string;
  /** The driver asking — their chip, their saved timing-site name, or a lap-for-lap match. */
  isMe: boolean;
  laps: number[];
};

export type LapsSession = {
  /** "A2-Main", "Heat 2", "Practice" — what the timing site called it, shortened. */
  label: string;
  className: string | null;
  /** The track's clock, "10:42"; null when the timing site gave no time. */
  clock: string | null;
  dateYmd: string;
  /** Every driver on the sheet, in the sheet's own order. Practice is one driver: the asker. */
  drivers: LapsDriver[];
};

/** Past this many sessions the earliest are dropped and the block says so. */
export const MAX_LAPS_SESSIONS = 40;
/** A ceiling on the block's size — ~9K tokens — so a long range can never crowd the KB out. */
export const MAX_LAPS_CHARS = 30_000;

const fmt = (v: number): string => v.toFixed(2);
const fmtDelta = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank percentile of a sorted list. */
function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export type LapsFigures = {
  best: number;
  top5: number;
  median: number;
  /** Median of the last five laps minus the median of the first five; null under ten laps. */
  lastFiveVsFirstFive: number | null;
  /** 90th-percentile lap minus 10th-percentile lap; null under five laps. */
  spread: number | null;
  /** Laps left out of the figures as partials — a race's opening lap from the grid, or a cut. */
  partials: number;
};

/**
 * A lap far SHORTER than the driver's own median is not a lap: a race result's first lap is the
 * run from the grid to the line (7.11 in an 18-second class on the founder's SA sheet), and a
 * cut is the same shape. The list still shows it; the figures leave it out.
 */
export const PARTIAL_LAP_FRACTION = 0.6;

/** The figures under a driver's laps. Null when there are no finite laps. */
export function lapsFigures(laps: readonly number[]): LapsFigures | null {
  const all = laps.filter((v) => Number.isFinite(v) && v > 0);
  if (all.length === 0) return null;
  const floor = (median(all) as number) * PARTIAL_LAP_FRACTION;
  const xs = all.filter((v) => v >= floor);
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const top = sorted.slice(0, Math.min(5, sorted.length));
  return {
    best: sorted[0],
    top5: top.reduce((a, b) => a + b, 0) / top.length,
    median: median(xs) as number,
    lastFiveVsFirstFive:
      xs.length >= 10 ? (median(xs.slice(-5)) as number) - (median(xs.slice(0, 5)) as number) : null,
    spread: xs.length >= 5 ? percentile(sorted, 0.9) - percentile(sorted, 0.1) : null,
    partials: all.length - xs.length,
  };
}

function renderDriver(d: LapsDriver): string[] {
  // A practice page names nobody: its one driver is the asker, and "you" is the whole name.
  const who = d.isMe ? (d.name.trim().toLowerCase() === "you" ? "you" : `${d.name} (you)`) : d.name;
  const f = lapsFigures(d.laps);
  if (!f) return [`  ${who}: no laps`];
  const figures = [
    `best ${fmt(f.best)}`,
    `top5 ${fmt(f.top5)}`,
    `median ${fmt(f.median)}`,
    f.lastFiveVsFirstFive != null ? `last five vs first five ${fmtDelta(f.lastFiveVsFirstFive)}` : null,
    f.spread != null ? `spread ${fmt(f.spread)}` : null,
    f.partials > 0 ? `${f.partials} partial lap${f.partials === 1 ? "" : "s"} left out` : null,
  ].filter(Boolean);
  return [`  ${who}: ${d.laps.map(fmt).join(" ")}`, `      ${figures.join(" · ")}`];
}

function renderSession(s: LapsSession, multiDay: boolean): string[] {
  const n = s.drivers.length;
  const head = [
    multiDay ? s.dateYmd : null,
    s.clock ?? "time unknown",
    `${s.label}${s.className ? ` · ${s.className}` : ""}`,
    `(${n} driver${n === 1 ? "" : "s"})`,
  ]
    .filter(Boolean)
    .join("  ");
  return [head, ...s.drivers.flatMap(renderDriver)];
}

/**
 * The block. `scopeLabel` names what the sessions were taken from — "12 Sep 2026 at Radio
 * Racing Cars SA", or the range's own label. Null when there is nothing to show.
 */
export function renderLapsBlock(sessions: readonly LapsSession[], scopeLabel: string): string | null {
  const withLaps = sessions.filter((s) => s.drivers.some((d) => d.laps.length > 0));
  if (withLaps.length === 0) return null;

  // Earliest first, like every other block; when over the caps the EARLIEST go, so the
  // sessions nearest the question survive.
  let kept = withLaps.slice(-MAX_LAPS_SESSIONS);
  const multiDay = new Set(kept.map((s) => s.dateYmd)).size > 1;
  let body = kept.flatMap((s) => [...renderSession(s, multiDay), ""]);
  while (kept.length > 1 && body.join("\n").length > MAX_LAPS_CHARS) {
    kept = kept.slice(1);
    body = kept.flatMap((s) => [...renderSession(s, multiDay), ""]);
  }
  const dropped = withLaps.length - kept.length;
  const anyUnmatched = kept.some((s) => s.drivers.length > 1 && !s.drivers.some((d) => d.isMe));
  const anyPractice = kept.some((s) => s.drivers.length === 1);

  return [
    `LAPS — every lap of every driver in the timed sessions you were in, ${scopeLabel}. Sessions earliest first; laps in the order they were driven; the clock is the track's.${dropped > 0 ? ` The ${dropped} earliest session${dropped === 1 ? " is" : "s are"} not shown.` : ""}`,
    `Under each driver, worked out in code from those laps: best; the average of the best 5; the median; the median of the last five laps minus the median of the first five (positive = slower at the end); and the spread, the 90th-percentile lap minus the 10th. A lap far outside the rest is usually a crash, a marshal or a stop, not pace. A "partial lap" is one under ${Math.round(PARTIAL_LAP_FRACTION * 100)}% of that driver's median — a race's opening lap from the grid, or a cut; it is listed but left out of the figures.`,
    ...(anyPractice
      ? [`A session with one driver is a practice session: the timing site keeps practice one driver per page, so only your own laps are here.`]
      : []),
    ...(anyUnmatched
      ? [`A session with more than one driver and no "(you)" is a sheet on which your row could not be told apart by name or chip.`]
      : []),
    "",
    ...body,
  ]
    .join("\n")
    .trimEnd();
}
