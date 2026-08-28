/**
 * Where to look, and when. The detector never scans a whole video — it is told roughly
 * when each crossing should happen and only decodes a few seconds either side.
 *
 * The predictions come from the transponder lap list plus one sync anchor, so they are as
 * good as the timing sheet. Three rules here each cost real debugging time offline and are
 * restated in `docs/SECTOR_COMPARE_NORTH_STAR.md`:
 *
 *  1. Walk the COMPLETE lap list, incident laps included. They still consume real time;
 *     dropping them shifted every later prediction by 20-50 s and collapsed detection.
 *  2. Bin a crossing to the lap whose SF interval it falls in, never to "its own lap" —
 *     in-lap offsets routinely exceed lap time and wrap into the following lap.
 *  3. Never invent a time. A lap with no clean crossing renders as a gap.
 */

import type { CrossingTarget, SectorLine } from "./types";

/** Seconds either side of the prediction that get decoded. */
export const WINDOW_SEC = 3.0;
/** Ignore predictions this close to either end of the file — the window would be clipped. */
const EDGE_HEAD_SEC = 5;
const EDGE_TAIL_SEC = 3;

export type TimedLap = { lapNumber: number; lapTimeSec: number };

/** The one hand-set fact tying video time to lap time. */
export type SyncAnchor = { lapNumber: number; videoTimeSec: number };

/**
 * Video time at which each lap starts, walking outward from the anchor in both directions.
 * Laps excluded from a driver's stats are still walked — see rule 1.
 */
export function lapStartTimes(anchor: SyncAnchor, laps: TimedLap[]): Map<number, number> {
  const byNumber = new Map<number, number>();
  for (const l of laps) byNumber.set(l.lapNumber, l.lapTimeSec);
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);

  const starts = new Map<number, number>();
  for (const lap of numbers) {
    let t = anchor.videoTimeSec;
    for (const n of numbers) {
      if (anchor.lapNumber <= n && n < lap) t += byNumber.get(n)!;
      if (lap <= n && n < anchor.lapNumber) t -= byNumber.get(n)!;
    }
    starts.set(lap, t);
  }
  return starts;
}

function withinVideo(t: number, durationSec: number): boolean {
  return t > EDGE_HEAD_SEC && t < durationSec - EDGE_TAIL_SEC;
}

/**
 * Start/finish crossings. These are special: their predicted time IS the transponder time,
 * so every one of them doubles as a free correctness check on the detector — the gaps
 * between detected SF crossings must reproduce the official lap times.
 */
export function sfBoundaryTargets(
  sfLineKey: string,
  anchor: SyncAnchor,
  laps: TimedLap[],
  durationSec: number
): CrossingTarget[] {
  const starts = lapStartTimes(anchor, laps);
  const numbers = [...starts.keys()].sort((a, b) => a - b);
  if (!numbers.length) return [];

  const boundaries: Array<{ lap: number; t: number }> = [
    { lap: numbers[0], t: starts.get(numbers[0])! },
  ];
  const byNumber = new Map(laps.map((l) => [l.lapNumber, l.lapTimeSec]));
  for (const n of numbers) {
    boundaries.push({ lap: n + 1, t: starts.get(n)! + byNumber.get(n)! });
  }

  return boundaries
    .filter((b) => withinVideo(b.t, durationSec))
    .map((b) => ({
      id: `${sfLineKey}-b${b.lap}`,
      lineKey: sfLineKey,
      lapNumber: b.lap,
      centerSec: b.t,
      truthSec: b.t,
    }));
}

/**
 * Corner crossings. `seedOffsets` is how long after a lap start this driver reaches each
 * line — taken from whichever driver already has crossings on these same lines. That is the
 * whole reason a second driver needs no hand marks at all.
 */
export function cornerTargets(
  lines: SectorLine[],
  sfLineKey: string,
  anchor: SyncAnchor,
  laps: TimedLap[],
  seedOffsets: Record<string, number>,
  durationSec: number
): CrossingTarget[] {
  const starts = lapStartTimes(anchor, laps);
  const numbers = [...starts.keys()].sort((a, b) => a - b);
  const cornerKeys = lines
    .filter((l) => l.lineKey !== sfLineKey)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => l.lineKey);

  const out: CrossingTarget[] = [];
  for (const lap of numbers) {
    for (const key of cornerKeys) {
      const offset = seedOffsets[key];
      if (offset == null) continue;
      const centerSec = starts.get(lap)! + offset;
      if (!withinVideo(centerSec, durationSec)) continue;
      out.push({ id: `${key}-L${lap}`, lineKey: key, lapNumber: lap, centerSec, truthSec: null });
    }
  }
  return out;
}

/**
 * Mean offset from lap start to each line, from crossings that are already known.
 * Feed it hand marks from the first driver, or detections from a driver already processed.
 */
export function seedOffsetsFromCrossings(
  crossings: Array<{ lineKey: string; lapNumber: number; videoTimeSec: number }>,
  anchor: SyncAnchor,
  laps: TimedLap[]
): Record<string, number> {
  const starts = lapStartTimes(anchor, laps);
  const sums: Record<string, { total: number; count: number }> = {};
  for (const c of crossings) {
    const start = starts.get(c.lapNumber);
    if (start == null) continue;
    const bucket = (sums[c.lineKey] ??= { total: 0, count: 0 });
    bucket.total += c.videoTimeSec - start;
    bucket.count += 1;
  }
  const out: Record<string, number> = {};
  for (const [key, { total, count }] of Object.entries(sums)) {
    if (count > 0) out[key] = total / count;
  }
  return out;
}
