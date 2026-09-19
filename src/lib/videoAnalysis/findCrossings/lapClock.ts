/**
 * Where each lap really sits on the video clock.
 *
 * A lap's start comes from the transponder: one anchor the driver sets on one lap, then every
 * other lap start is that anchor plus the lap times added up. That is exact only if every lap
 * time is exact, and it never recovers if one is not — an error is carried forward for the rest
 * of the session.
 *
 * Measured on the Bendigo practice of 2026-09-01 (job cmti09r7…, LiveRC session 24468914): the
 * whole chain of six crossings slid from +1.71s to +0.74s against the walked lap starts over nine
 * laps, and most of that arrived in one step — the timing sheet said lap 8 took 15.445s while
 * three separate lines filmed it at 14.89–15.03s. Every lap after that inherited the half second.
 *
 * Two things went wrong because of it, and neither looks like a clock problem from the outside:
 *
 *   1. **Sector 1 was wrong.** It is the only sector with one end on the transponder clock (the
 *      lap start) instead of on a detected line, so it absorbed the entire drift. On the best lap
 *      it read 0.34s slow while every gap between two detected lines held to 0.065–0.114s.
 *   2. **Good crossings were thrown away.** Laps 9, 10 and 11 were held as "odd" because their
 *      offsets from those same drifting lap starts no longer clustered with the earlier laps.
 *
 * So: measure the drift instead of trusting the walk. Each lap's own crossings say where that lap
 * really sits — take each line's usual offset from the lap start, and what is left over is that
 * lap's error. Smooth it across neighbouring laps, because a clock drifts and steps but never
 * jitters: a single lap that disagrees with its neighbours is a wrong car, not a wrong clock, and
 * must stay flagged rather than be explained away.
 */

import type { LapKeyOf, RefinableResult } from "./refine";

/** A lap must have this many detected lines before its drift means anything. */
const MIN_LINES_FOR_DRIFT = 3;
/**
 * How much the lines on one lap may disagree about that lap's drift. Above this the lap is not
 * telling us about the clock — its crossings disagree with each other, which is the signature of
 * a lap read off more than one car.
 */
const MAX_LINE_SPREAD_SEC = 0.4;
/**
 * Neighbours each side used to smooth a lap's drift. A clock's error is shared with the laps
 * around it; one lap's alone is exactly what a followed rival would produce.
 */
const SMOOTH_HALF_WINDOW = 2;
/** Beyond this, it is not a clock error at all — leave it to the plausibility check. */
const MAX_DRIFT_SEC = 2.5;

export type LapDrift = {
  lapKey: string;
  /** What this lap's own crossings say, before smoothing. Null when too few, or they disagree. */
  rawSec: number | null;
  /** The number to use: this lap's drift as its neighbours also see it. */
  driftSec: number;
  /** Detected lines behind `rawSec`. */
  lines: number;
  /** How much those lines disagreed. */
  spreadSec: number | null;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** Lap number out of a lap key ("me:7" → 7), so neighbours can be found. */
function lapNumberOfKey(key: string): number {
  const i = key.lastIndexOf(":");
  return Number(i < 0 ? key : key.slice(i + 1));
}

function driverOfKey(key: string): string {
  const i = key.lastIndexOf(":");
  return i < 0 ? "" : key.slice(0, i);
}

/**
 * How far each lap's crossings sit from where the walked lap start says they should.
 *
 * `sfAt` is the walk — the lap starts as the transponder has them. The answer is per lap, in
 * seconds, positive when the lap really happened LATER than the walk claims.
 */
export function lapDrift<T extends RefinableResult>(
  results: T[],
  sfAt: Map<string, number>,
  sfKey: string,
  lapKey: LapKeyOf<T>
): Map<string, LapDrift> {
  // Each line's usual offset from its lap start, per driver — the shape of a lap.
  const offsets = new Map<string, number[]>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const key = lapKey(r);
    const start = sfAt.get(key);
    if (start == null) continue;
    const group = `${driverOfKey(key)}|${r.lineKey}`;
    const list = offsets.get(group) ?? [];
    list.push(r.detectedSec - start);
    offsets.set(group, list);
  }
  const usual = new Map([...offsets].map(([g, xs]) => [g, median(xs)]));

  // What is left over on each lap, once each line's usual offset is taken off, is that lap's own
  // error. Six lines say it six times; they should agree.
  const raw = new Map<string, { rawSec: number | null; lines: number; spreadSec: number | null }>();
  const byLap = new Map<string, number[]>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const key = lapKey(r);
    const start = sfAt.get(key);
    const u = usual.get(`${driverOfKey(key)}|${r.lineKey}`);
    if (start == null || u == null) continue;
    const list = byLap.get(key) ?? [];
    list.push(r.detectedSec - start - u);
    byLap.set(key, list);
  }
  for (const [key, list] of byLap) {
    const spread = list.length > 1 ? Math.max(...list) - Math.min(...list) : 0;
    const ok = list.length >= MIN_LINES_FOR_DRIFT && spread <= MAX_LINE_SPREAD_SEC;
    raw.set(key, {
      rawSec: ok ? median(list) : null,
      lines: list.length,
      spreadSec: list.length > 1 ? spread : null,
    });
  }

  // Smooth over neighbouring laps of the same driver. A clock drifts and it steps; it does not
  // jitter. One lap that disagrees with the laps either side is a car, not a clock, and must stay
  // visible — so a lap is never allowed to explain itself.
  //
  // Three windows are tried (the laps before, the laps around, the laps after) and the most
  // agreeing one wins. A plain centred window blurs a step across the laps either side of it,
  // which matters because a wrong lap time in the timing sheet IS a step: at Bendigo the sheet's
  // lap 8 was half a second long, and every lap from 9 on inherited it exactly.
  const out = new Map<string, LapDrift>();
  const valueAt = (driver: string, n: number): number | null =>
    raw.get(driver ? `${driver}:${n}` : String(n))?.rawSec ?? null;

  for (const [key, r] of raw) {
    const driver = driverOfKey(key);
    const n = lapNumberOfKey(key);
    let best: { med: number; spread: number } | null = null;
    for (const [from, to] of [
      [-SMOOTH_HALF_WINDOW, 0],
      [-1, 1],
      [0, SMOOTH_HALF_WINDOW],
    ] as const) {
      const near: number[] = [];
      for (let d = from; d <= to; d++) {
        const v = valueAt(driver, n + d);
        if (v != null) near.push(v);
      }
      if (near.length < 2) continue;
      const spread = Math.max(...near) - Math.min(...near);
      if (!best || spread < best.spread) best = { med: median(near), spread };
    }
    let drift = best ? best.med : 0;
    if (!Number.isFinite(drift) || Math.abs(drift) > MAX_DRIFT_SEC) drift = 0;
    out.set(key, { lapKey: key, rawSec: r.rawSec, driftSec: drift, lines: r.lines, spreadSec: r.spreadSec });
  }
  return out;
}

/**
 * The lap starts to actually use: the walk, moved by the drift its own lap shows.
 *
 * This is not a substitute for detecting the start/finish line — an estimated boundary can never
 * measure sector 1, only stop it being wrong by a second. It is what makes every other judgement
 * (which window to search, whether a crossing is odd) stop inheriting the timing sheet's errors.
 */
export function correctedLapStarts(
  sfAt: Map<string, number>,
  drift: Map<string, LapDrift>
): Map<string, number> {
  const out = new Map(sfAt);
  for (const [key, start] of sfAt) {
    const d = drift.get(key);
    if (d) out.set(key, start + d.driftSec);
  }
  return out;
}

export type ClockDisagreement = {
  lapKey: string;
  /** The lap's length as the video filmed it, from one detected line to the same line next lap. */
  filmedSec: number;
  /** What the timing sheet says that lap took. */
  timedSec: number;
  /** filmed − timed. Positive: the video says the lap took longer than the sheet does. */
  diffSec: number;
  /** Lines that agreed on it. */
  lines: number;
};

/**
 * Laps where the footage and the timing sheet disagree about how long the lap took.
 *
 * Worth surfacing rather than absorbing: one of the two is wrong, and only the driver can say
 * which. Silently, the difference used to land in sector 1 and then in every following lap.
 */
export function clockDisagreements<T extends RefinableResult>(
  results: T[],
  lapTimeSec: (lapKey: string) => number | null,
  sfKey: string,
  lapKey: LapKeyOf<T>,
  tolSec = 0.2
): ClockDisagreement[] {
  const at = new Map<string, Map<string, number>>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const key = lapKey(r);
    const perLine = at.get(key) ?? new Map<string, number>();
    perLine.set(r.lineKey, r.detectedSec);
    at.set(key, perLine);
  }

  const out: ClockDisagreement[] = [];
  for (const [key, perLine] of at) {
    const driver = driverOfKey(key);
    const n = lapNumberOfKey(key);
    const nextKey = driver ? `${driver}:${n + 1}` : String(n + 1);
    const next = at.get(nextKey);
    const timed = lapTimeSec(key);
    if (!next || timed == null) continue;
    // The same line, one lap apart, is the lap's length with nothing else in it.
    const filmed = [...perLine]
      .filter(([line]) => next.has(line))
      .map(([line, t]) => next.get(line)! - t);
    if (filmed.length < 2) continue;
    const f = median(filmed);
    if (Math.abs(f - timed) <= tolSec) continue;
    out.push({ lapKey: key, filmedSec: f, timedSec: timed, diffSec: f - timed, lines: filmed.length });
  }
  return out.sort((a, b) => Math.abs(b.diffSec) - Math.abs(a.diffSec));
}
