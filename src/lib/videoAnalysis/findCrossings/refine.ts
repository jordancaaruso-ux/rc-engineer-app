/**
 * Second pass: re-read each lap as a lap, instead of five unrelated windows.
 *
 * Each window is searched around a predicted time, and that prediction is anchored at the start
 * line — up to twenty-odd seconds earlier. That is fine on a normal lap and poor on a bad one:
 * measured on a lap where the driver lost about a second and a half early on, the prediction for
 * every corner after that was a second and a half out, and one corner picked a candidate three
 * seconds from the truth simply because it sat closer to a stale guess.
 *
 * The fix is to chain. The gap between two ADJACENT corners is short and barely varies — around
 * a second and a half, with a few hundredths of spread across a whole race — so once a corner is
 * known, the next one is predictable far more tightly than anything anchored at the start line.
 * Walking the lap in track order and predicting each crossing from the one before it therefore
 * shrinks the search from "somewhere in three seconds" to "within a few tenths", and a slow lap
 * stops poisoning everything after it.
 *
 * It also makes track order impossible to violate, which the single-window pick could not
 * promise: nothing here can place a corner before the corner in front of it.
 *
 * Deliberately NOT what this does: it never invents a crossing, never moves one to a time no
 * candidate was found at, and never overrides a pick that is already consistent. Every value it
 * produces is one the detector genuinely saw in the footage.
 */

import type { CrossingEvent } from "./types";

/** What the second pass needs from the first: where it looked, and what it found. */
export type RefinableResult = {
  id: string;
  lineKey: string;
  lapNumber: number;
  centerSec: number;
  detectedSec: number | null;
  quality: number | null;
  /** Candidates the window produced, after tracking filtered them. */
  candidates: CrossingEvent[];
  /** Whether the first pass's answer was backed by a tracked object. */
  source: "confirmed" | "rescued" | "unconfirmed" | null;
};

export type RefineOutcome<T> = T & {
  /** Set when the second pass moved this crossing, with how far and why. */
  movedBy?: number;
};

/**
 * Which lap a result belongs to, as a string. Two drivers in the same video both have a lap 7,
 * and chaining one driver's corners through the other's is nonsense — so the caller can widen
 * the key to include the driver.
 */
export type LapKeyOf<T> = (r: T) => string;

const defaultLapKey = (r: RefinableResult) => String(r.lapNumber);

/**
 * How far from the chained prediction a candidate may sit and still be accepted. Wide enough to
 * cover a genuine mistake in that corner (a half-second bobble is common), tight enough that the
 * three-second impostor which prompted this cannot win.
 */
const MAX_CHAIN_DRIFT_SEC = 1.2;
/** Fewest laps a gap must be measured over before it is trusted as a prediction. */
const MIN_GAP_SAMPLES = 4;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Track order and adjacent gaps, learned from the detections themselves.
 *
 * Nothing tells us which corner comes first — the lines are drawn in whatever order the driver
 * drew them, and their names carry no geography. But across a whole race the median time from
 * the start line to each corner is unambiguous, so the order falls out of the data.
 */
export function learnLapShape<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T> = defaultLapKey
) {
  const sfAt = new Map(
    results
      .filter((r) => r.lineKey === sfKey && r.detectedSec != null)
      .map((r) => [lapKey(r), r.detectedSec!])
  );

  const offsets = new Map<string, number[]>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const start = sfAt.get(lapKey(r));
    if (start == null) continue;
    const list = offsets.get(r.lineKey) ?? [];
    list.push(r.detectedSec - start);
    offsets.set(r.lineKey, list);
  }

  const order = [sfKey, ...[...offsets].sort((a, b) => median(a[1]) - median(b[1])).map(([k]) => k)];

  // Gap between every ordered pair, not just neighbours: when a corner is missed on some lap the
  // chain has to reach over it to the next one, and a two-corner gap is still far tighter than
  // an anchor at the start line.
  const found = new Map<string, number>();
  for (const r of results) {
    if (r.detectedSec != null) found.set(`${r.lineKey}|${lapKey(r)}`, r.detectedSec);
  }
  const laps = [...new Set(results.map(lapKey))];
  const gaps = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const samples: number[] = [];
      for (const lap of laps) {
        const a = found.get(`${order[i]}|${lap}`);
        const b = found.get(`${order[j]}|${lap}`);
        if (a == null || b == null || b <= a) continue;
        samples.push(b - a);
      }
      if (samples.length >= MIN_GAP_SAMPLES) {
        gaps.set(`${order[i]}>${order[j]}`, median(samples));
      }
    }
  }

  return { order, gaps, sfAt };
}

/**
 * Is this crossing a believable sector time for this line?
 *
 * The time from a lap start to a given corner barely moves lap to lap, and the lap starts come
 * from the transponder — so a line's offsets are independent evidence, not the detector grading
 * itself. The laps that agree with each other are the car; anything outside that agreement is
 * something else that moved.
 *
 * **Agreement is found by the biggest cluster, not by the median.** The first version took the
 * median offset and a spread around it, and that quietly dies once a third of the laps are wrong:
 * on a six-car race the detector followed a named rival for whole laps at a time — one lap 1.8s
 * early, two laps 1.1s early, two laps 0.5s late — the spread ballooned to cover all of them, and
 * nothing was flagged. Six laps sitting within a third of a second of each other are still the
 * biggest thing in that list, whichever way the rest scatter, and that is what is kept.
 *
 * This is the check that decides what gets written into a driver's marks without being asked.
 * It has nothing to do with confidence: a crossing can be confidently detected and still be the
 * wrong object, and this catches that where confidence cannot.
 */
const PLAUSIBLE_TOL_SEC = 0.35;
const MIN_PLAUSIBILITY_SAMPLES = 4;
/** Fewest laps that must agree before disagreement means anything. */
const MIN_CLUSTER_LAPS = 3;

/**
 * The driver a lap key belongs to — everything before the lap number ("me:7" → "me"), or "" when
 * the key is a bare lap number and there is only one driver.
 */
function driverOfKey(key: string): string {
  const i = key.lastIndexOf(":");
  return i < 0 ? "" : key.slice(0, i);
}

export function flagImplausible<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T> = defaultLapKey
): Set<string> {
  const shape = learnLapShape(results, sfKey, lapKey);

  // **One driver at a time.** The first version pooled both scanned drivers on a line into one
  // sample, and it fell over on the first race where one was quicker: at Test A3 (2026-08-29)
  // Sandy ran 0.8s a lap faster than Jordan, so by the second line she was half a second earlier
  // relative to her own lap start than he was to his. The pooled centre sat between them and
  // belonged to neither — half of EACH driver's rows fell outside it, and a scan came back
  // "20 added, 20 odd" with the detector having found 36 of 40. The transponder gives every
  // driver their own lap starts; the agreement that matters is a driver with themselves.
  const byDriverLine = new Map<string, Array<{ id: string; offset: number }>>();
  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null) continue;
    const key = lapKey(r);
    const start = shape.sfAt.get(key);
    if (start == null) continue;
    const group = `${driverOfKey(key)}|${r.lineKey}`;
    const list = byDriverLine.get(group) ?? [];
    list.push({ id: r.id, offset: r.detectedSec - start });
    byDriverLine.set(group, list);
  }

  const suspect = new Set<string>();
  for (const [, list] of byDriverLine) {
    // Too few laps and any cluster is a coincidence — better to flag nothing than to flag at random.
    if (list.length < MIN_PLAUSIBILITY_SAMPLES) continue;
    const core = largestCluster(list.map((l) => l.offset), PLAUSIBLE_TOL_SEC);
    if (core.length < MIN_CLUSTER_LAPS) {
      // A car we could not follow at all. On the Boronia heat of 2026-08-28 every crossing
      // written for one driver was another car's: against that driver's own lap starts the
      // offsets drifted three quarters of a second a lap and never clustered — and "no cluster"
      // used to mean "hold nothing", so all of it was written as fact and the compare read
      // "gained eight seconds in S3". Enough rows to expect agreement and none of it is a car
      // that was not followed, and the honest answer is to hold every one of them, not none.
      for (const l of list) suspect.add(l.id);
      continue;
    }
    // The tolerance is measured from the cluster's own centre, so a cluster that happens to sit at
    // one end of its window does not lose a member to the arithmetic.
    const centre = median(core);
    for (const l of list) if (Math.abs(l.offset - centre) > PLAUSIBLE_TOL_SEC) suspect.add(l.id);
  }

  // Second opinion, by segment: a slow lap in traffic pushes every later corner away from its
  // usual offset from the lap START, while the time from the previous corner barely moves — on
  // the Boronia race a crossing the field had placed to 3ms was held back this way, because the
  // driver lost four tenths early in the lap. So a row the offset rule doubts is kept when its
  // gap from the last trusted corner before it on that lap agrees with that gap on the other
  // laps. A rival's crossing fails this too: measured from OUR previous corner, its gap is off.
  // The previous corner must itself be trusted (the lap start, or one the offset rule passed), or
  // a rival's chain would vouch for itself corner to corner.
  const rank = new Map(shape.order.map((k, i) => [k, i]));
  const found = new Map<string, number>();
  for (const r of results) {
    if (r.detectedSec != null) found.set(`${r.lineKey}|${lapKey(r)}`, r.detectedSec);
  }
  const laps = [...new Set(results.map(lapKey))];
  const trustedBefore = (lineKey: string, lap: string): { key: string; t: number } | null => {
    const mine = rank.get(lineKey);
    if (mine == null) return null;
    for (let i = mine - 1; i >= 0; i--) {
      const key = shape.order[i]!;
      const t = key === sfKey ? shape.sfAt.get(lap) : found.get(`${key}|${lap}`);
      if (t == null) continue;
      if (key !== sfKey) {
        const row = results.find((r) => r.lineKey === key && lapKey(r) === lap);
        if (!row || suspect.has(row.id)) continue;
      }
      return { key, t };
    }
    return null;
  };
  for (const r of results) {
    if (!suspect.has(r.id) || r.detectedSec == null) continue;
    const lap = lapKey(r);
    const prev = trustedBefore(r.lineKey, lap);
    if (!prev) continue;
    // The same gap on every other lap of THIS driver where both corners were found and trusted.
    const samples: number[] = [];
    for (const other of laps) {
      if (other === lap || driverOfKey(other) !== driverOfKey(lap)) continue;
      const a = prev.key === sfKey ? shape.sfAt.get(other) : found.get(`${prev.key}|${other}`);
      const b = found.get(`${r.lineKey}|${other}`);
      if (a == null || b == null || b <= a) continue;
      const rowB = results.find((x) => x.lineKey === r.lineKey && lapKey(x) === other);
      if (rowB && suspect.has(rowB.id)) continue;
      samples.push(b - a);
    }
    if (samples.length < MIN_CLUSTER_LAPS) continue;
    const core = largestCluster(samples, PLAUSIBLE_TOL_SEC);
    if (core.length < MIN_CLUSTER_LAPS) continue;
    if (Math.abs(r.detectedSec - prev.t - median(core)) <= PLAUSIBLE_TOL_SEC) suspect.delete(r.id);
  }
  return suspect;
}

/**
 * Which untracked crossings the timing vouches for.
 *
 * A window's answer is "unconfirmed" when no tracked object backed it — a frame-pair sign flip,
 * which is also what shaken paint looks like — and those are held back rather than written.
 * But the same evidence that convicts a wrong crossing can acquit a right one: on the Fisheye
 * race of 2026-08-28 two unconfirmed rows sat within a twentieth of a second of where that
 * driver crossed that line on every other lap, and were held anyway. So: an unconfirmed row is
 * vouched for when its offset from its own lap start sits inside the tolerance of the cluster
 * formed by that driver's TRACKED, undoubted crossings of the same line (at least three of
 * them — flickers never vouch for each other), or when its gap from the previous trusted corner
 * matches that gap on the driver's other laps. Rows already held by `flagImplausible` are never
 * vouched for. A vouched row still says "unconfirmed", so the review can call it less certain.
 */
export function vouchedUnconfirmed<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T> = defaultLapKey,
  suspect: ReadonlySet<string> = new Set()
): Set<string> {
  const shape = learnLapShape(results, sfKey, lapKey);
  const trusted = (r: T) =>
    r.detectedSec != null && r.source !== "unconfirmed" && !suspect.has(r.id);

  const vouched = new Set<string>();
  const trustedOffsets = new Map<string, number[]>();
  for (const r of results) {
    if (r.lineKey === sfKey || !trusted(r)) continue;
    const key = lapKey(r);
    const start = shape.sfAt.get(key);
    if (start == null) continue;
    const group = `${driverOfKey(key)}|${r.lineKey}`;
    const list = trustedOffsets.get(group) ?? [];
    list.push(r.detectedSec! - start);
    trustedOffsets.set(group, list);
  }

  const rank = new Map(shape.order.map((k, i) => [k, i]));
  const rowAt = new Map<string, T>();
  for (const r of results) rowAt.set(`${r.lineKey}|${lapKey(r)}`, r);
  const laps = [...new Set(results.map(lapKey))];
  const trustedBefore = (lineKey: string, lap: string): { key: string; t: number } | null => {
    const mine = rank.get(lineKey);
    if (mine == null) return null;
    for (let i = mine - 1; i >= 0; i--) {
      const key = shape.order[i]!;
      if (key === sfKey) {
        const t = shape.sfAt.get(lap);
        return t == null ? null : { key, t };
      }
      const row = rowAt.get(`${key}|${lap}`);
      if (row && trusted(row)) return { key, t: row.detectedSec! };
    }
    return null;
  };

  for (const r of results) {
    if (r.lineKey === sfKey || r.detectedSec == null || r.source !== "unconfirmed") continue;
    if (suspect.has(r.id)) continue;
    const key = lapKey(r);
    const start = shape.sfAt.get(key);
    if (start == null) continue;

    const own = trustedOffsets.get(`${driverOfKey(key)}|${r.lineKey}`) ?? [];
    if (own.length >= MIN_CLUSTER_LAPS) {
      const core = largestCluster(own, PLAUSIBLE_TOL_SEC);
      if (core.length >= MIN_CLUSTER_LAPS && Math.abs(r.detectedSec - start - median(core)) <= PLAUSIBLE_TOL_SEC) {
        vouched.add(r.id);
        continue;
      }
    }

    const prev = trustedBefore(r.lineKey, key);
    if (!prev) continue;
    const samples: number[] = [];
    for (const other of laps) {
      if (other === key || driverOfKey(other) !== driverOfKey(key)) continue;
      let at: number | null = null;
      if (prev.key === sfKey) at = shape.sfAt.get(other) ?? null;
      else {
        const a = rowAt.get(`${prev.key}|${other}`);
        at = a && trusted(a) ? a.detectedSec! : null;
      }
      const b = rowAt.get(`${r.lineKey}|${other}`);
      if (at == null || !b || !trusted(b) || b.detectedSec! <= at) continue;
      samples.push(b.detectedSec! - at);
    }
    if (samples.length < MIN_CLUSTER_LAPS) continue;
    const core = largestCluster(samples, PLAUSIBLE_TOL_SEC);
    if (core.length < MIN_CLUSTER_LAPS) continue;
    if (Math.abs(r.detectedSec - prev.t - median(core)) <= PLAUSIBLE_TOL_SEC) vouched.add(r.id);
  }
  return vouched;
}

/**
 * The largest set of values that all sit within `tol` of one another.
 *
 * Every value is tried as a window centre; the window with the most members wins, and ties go to
 * the tighter one. Fine for the dozen or so laps a line ever has.
 */
function largestCluster(values: number[], tol: number): number[] {
  let best: number[] = [];
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const c of values) {
    const members = values.filter((v) => Math.abs(v - c) <= tol);
    const spread = Math.max(...members) - Math.min(...members);
    if (members.length > best.length || (members.length === best.length && spread < bestSpread)) {
      best = members;
      bestSpread = spread;
    }
  }
  return best;
}

/**
 * Walk each lap in track order, predicting each crossing from the one before it.
 *
 * The chain only advances on answers worth chaining from — a tracked one, or one that landed
 * where the chain expected. A guess never becomes the anchor for the next guess.
 */
export function refineByChaining<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T> = defaultLapKey
): Array<RefineOutcome<T>> {
  const shape = learnLapShape(results, sfKey, lapKey);
  const out = results.map((r) => ({ ...r }) as RefineOutcome<T>);
  const index = new Map(out.map((r) => [`${r.lineKey}|${lapKey(r)}`, r]));
  const laps = [...new Set(out.map(lapKey))];

  for (const lap of laps) {
    let anchorKey: string | null = null;
    let anchorTime: number | null = null;

    for (const key of shape.order) {
      const row = index.get(`${key}|${lap}`);
      if (!row) continue;

      const gap = anchorKey ? shape.gaps.get(`${anchorKey}>${key}`) : undefined;
      const expected = anchorTime != null && gap != null ? anchorTime + gap : null;

      if (expected != null && row.candidates.length) {
        let best: CrossingEvent | null = null;
        for (const c of row.candidates) {
          if (Math.abs(c.t - expected) > MAX_CHAIN_DRIFT_SEC) continue;
          if (!best || Math.abs(c.t - expected) < Math.abs(best.t - expected)) best = c;
        }
        if (best && best.t !== row.detectedSec) {
          if (row.detectedSec != null) row.movedBy = best.t - row.detectedSec;
          row.detectedSec = best.t;
          row.quality = best.quality;
        }
      }

      // Anchor the next prediction only on something solid: a tracked crossing, or one that
      // agreed with the chain. Otherwise keep the previous anchor and let the gap grow — a long
      // gap predicts less tightly, which is the honest consequence of not knowing.
      if (
        row.detectedSec != null &&
        (row.source === "confirmed" ||
          row.source === "rescued" ||
          (expected != null && Math.abs(row.detectedSec - expected) < MAX_CHAIN_DRIFT_SEC))
      ) {
        anchorKey = key;
        anchorTime = row.detectedSec;
      }
    }
  }

  return out;
}

/**
 * One car cannot be in two places at once, so two laps cannot share a crossing.
 *
 * A race's opening lap used to arrive here as a fragment aimed at roughly the same piece of
 * video as lap two, and both laps walked away holding the identical timestamp — which then
 * looked like two confident detections rather than one detection counted twice. Whichever of the
 * pair has the weaker evidence loses its time entirely: an honest gap beats a duplicated answer,
 * because a gap can be filled later and a wrong time cannot be spotted from the numbers alone.
 *
 * `groupKey` must separate the things that genuinely repeat — one driver, one line — so two
 * drivers crossing together are never mistaken for one car counted twice.
 */
export function dropDuplicates<T extends RefinableResult>(
  results: T[],
  groupKey: (r: T) => string,
  minGapSec: number
): Set<string> {
  const rank = (r: T) =>
    r.source === "confirmed" ? 3 : r.source === "rescued" ? 2 : r.source === "unconfirmed" ? 1 : 0;

  const groups = new Map<string, T[]>();
  for (const r of results) {
    if (r.detectedSec == null) continue;
    const k = groupKey(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }

  const dropped = new Set<string>();
  for (const [, list] of groups) {
    const sorted = [...list].sort((a, b) => a.detectedSec! - b.detectedSec!);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (dropped.has(a.id) || b.detectedSec! - a.detectedSec! >= minGapSec) continue;
      // Better evidence wins; a tie goes to whichever landed nearer the time it was looking for,
      // which is the only thing left that distinguishes them.
      const loser =
        rank(a) !== rank(b)
          ? rank(a) < rank(b)
            ? a
            : b
          : Math.abs(a.detectedSec! - a.centerSec) > Math.abs(b.detectedSec! - b.centerSec)
            ? a
            : b;
      dropped.add(loser.id);
    }
  }
  return dropped;
}

/**
 * A lap has to visit the corners in the order they sit on the track.
 *
 * When two crossings on one lap come back in the wrong order, at least one of them is not this
 * car — the sequence itself is the proof, no reference data needed. The one further from its own
 * line's usual sector time is the one held back; the other may well be right, and throwing both
 * away would cost a good crossing to punish a bad one.
 */
export function flagOutOfOrder<T extends RefinableResult>(
  results: T[],
  sfKey: string,
  lapKey: LapKeyOf<T> = defaultLapKey
): Set<string> {
  const shape = learnLapShape(results, sfKey, lapKey);
  const rank = new Map(shape.order.map((k, i) => [k, i]));

  const typical = new Map<string, number>();
  for (const line of shape.order) {
    const offs: number[] = [];
    for (const r of results) {
      if (r.lineKey !== line || r.detectedSec == null) continue;
      const start = shape.sfAt.get(lapKey(r));
      if (start != null) offs.push(r.detectedSec - start);
    }
    if (offs.length) typical.set(line, median(offs));
  }

  const byLap = new Map<string, T[]>();
  for (const r of results) {
    if (r.detectedSec == null || r.lineKey === sfKey || !rank.has(r.lineKey)) continue;
    const list = byLap.get(lapKey(r)) ?? [];
    list.push(r);
    byLap.set(lapKey(r), list);
  }

  const odd = new Set<string>();
  for (const [key, list] of byLap) {
    const start = shape.sfAt.get(key);
    const sorted = [...list].sort((a, b) => rank.get(a.lineKey)! - rank.get(b.lineKey)!);
    const strayFromUsual = (r: T) => {
      const t = typical.get(r.lineKey);
      if (t == null || start == null) return 0;
      return Math.abs(r.detectedSec! - start - t);
    };
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (b.detectedSec! > a.detectedSec!) continue;
      odd.add(strayFromUsual(a) >= strayFromUsual(b) ? a.id : b.id);
    }
  }
  return odd;
}
