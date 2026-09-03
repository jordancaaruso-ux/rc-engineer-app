/**
 * Find a driver on the video from their lap times alone.
 *
 * In a race everybody leaves on the tone, so one sync point places the whole field: their
 * transponder clock and yours share a zero. Practice shares nothing — each driver's session
 * starts whenever they pressed go — so every person added from their own practice link needs
 * their own tie point between the two clocks.
 *
 * Asking for it is not an option. His finding, 2026-08-27: "I never selected when Sandy crossed
 * the line… didn't really make sense" — a driver can pick their own car out of a video, but
 * nobody can pick out a stranger among six identical shells. So it is worked out instead.
 *
 * The way in is that a run of lap times is a fingerprint. 17.24, 17.51, 16.98, 17.33 — those
 * gaps are not round and they do not repeat, so the sequence only lies flat against one place on
 * a list of observed start/finish crossings. Slide it until it locks: the offset that puts the
 * most of their laps on top of a real crossing is where they are. Everything here is pure, so it
 * can be tested against a made-up field without a video anywhere near it.
 */

export type FingerprintLap = { lapNumber: number; lapTimeSec: number };

export type FingerprintFit = {
  /** Video time at which this driver's first lap starts. */
  lapOneStartSec: number;
  /** The cleanest matched lap, and the crossing it landed on — what the anchor is written from. */
  anchorLapNumber: number;
  anchorVideoTimeSec: number;
  /** How many of their laps landed on a crossing, out of how many could have. */
  matched: number;
  of: number;
  medianErrorSec: number;
  /**
   * How many more laps this fit matched than the best unrelated one.
   *
   * The honesty check. A real lock beats every other placement by a mile, because the lap times
   * are irregular; two answers within a lap or two of each other means the footage does not say
   * where this driver is, and the screen should ask rather than guess.
   */
  marginLaps: number;
};

export type FingerprintOptions = {
  /** How close a predicted lap start must be to a real crossing to count as the same event. */
  tolSec?: number;
  /** Fewest matched laps that can ever be believed, however short the visible stretch. */
  minLaps?: number;
  /**
   * Share of the laps that could have been seen which must actually have been.
   *
   * Deliberately loose. Somebody who came out late or went in early is on track for part of the
   * sweep and missing from the rest, and that is not a worse answer — the count and the margin
   * below are what decide, and a partial lock is reported as the fraction it is.
   */
  minShare?: number;
  /** Fewest laps by which the answer must beat the runner-up. */
  minMarginLaps?: number;
};

const DEFAULTS: Required<FingerprintOptions> = {
  tolSec: 0.25,
  minLaps: 4,
  minShare: 0.4,
  minMarginLaps: 1.5,
};

/**
 * How far out a lap can land and still count as a whole lap of evidence.
 *
 * Counting matches alone does not separate two cars on similar lap times: over five laps a rival's
 * crossings can be talked into fitting just as often as the driver's own. What tells them apart is
 * how *tightly* they fit — measured on a real case, the right answer sat dead on every crossing
 * (0.000s total) while the best wrong one averaged 0.08s. So a lap counts for a full lap when it
 * lands within a frame or two and fades away beyond that, which turns a distinction the count
 * could not make into one nothing else has to.
 */
const TIGHT_SEC = 0.08;

/** A lap's worth of evidence, from how close it landed. */
function weigh(errSec: number): number {
  const z = errSec / TIGHT_SEC;
  return Math.exp(-z * z);
}

/**
 * Two offsets closer than this are the same answer seen twice, not rivals.
 *
 * Every matched lap produces its own slightly different offset, and without this the runner-up
 * would always be the winner's own near-twin and the margin would always read zero.
 */
const SAME_ANSWER_SEC = 1.0;

/** Lap starts relative to the first lap's start, in the order the laps were run. */
function cumulativeStarts(laps: FingerprintLap[]): Array<{ lapNumber: number; atSec: number }> {
  const ordered = [...laps]
    .filter((l) => l.lapTimeSec > 0)
    .sort((a, b) => a.lapNumber - b.lapNumber);
  const out: Array<{ lapNumber: number; atSec: number }> = [];
  let at = 0;
  for (const lap of ordered) {
    out.push({ lapNumber: lap.lapNumber, atSec: at });
    at += lap.lapTimeSec;
  }
  return out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Nearest crossing to a moment, by binary search over a sorted list. */
function nearest(sorted: number[], t: number): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  const a = sorted[lo]!;
  const b = lo > 0 ? sorted[lo - 1]! : a;
  return Math.abs(a - t) <= Math.abs(b - t) ? a : b;
}

type Score = {
  offsetSec: number;
  matched: number;
  of: number;
  /** Matched laps weighted by how tightly each landed — the number placements are ranked on. */
  weight: number;
  errors: number[];
  best: { lapNumber: number; atSec: number; crossingSec: number; errSec: number } | null;
};

/**
 * How well one placement fits.
 *
 * Only laps that would fall inside the stretch actually looked at are counted against the driver.
 * A practice session that ran on after the camera stopped is not a worse fit for its unseen laps.
 */
function score(
  starts: Array<{ lapNumber: number; atSec: number }>,
  crossings: number[],
  offsetSec: number,
  spanFrom: number,
  spanTo: number,
  tolSec: number
): Score {
  let of = 0;
  let weight = 0;
  const errors: number[] = [];
  let best: Score["best"] = null;
  for (const s of starts) {
    const at = s.atSec + offsetSec;
    if (at < spanFrom - tolSec || at > spanTo + tolSec) continue;
    of++;
    const hit = nearest(crossings, at);
    if (hit == null) continue;
    const err = hit - at;
    if (Math.abs(err) > tolSec) continue;
    errors.push(err);
    weight += weigh(err);
    if (!best || Math.abs(err) < Math.abs(best.errSec)) {
      best = { lapNumber: s.lapNumber, atSec: s.atSec, crossingSec: hit, errSec: err };
    }
  }
  return { offsetSec, matched: errors.length, of, weight, errors, best };
}

/**
 * Where this driver's laps sit on the video, or null when the footage does not say.
 *
 * `crossingsSec` is every crossing of the start/finish line the sweep saw, whoever it belonged
 * to — the point is that their own laps are in there somewhere and only they line up.
 */
export function fitLapsToCrossings(
  laps: FingerprintLap[],
  crossingsSec: number[],
  opts: FingerprintOptions = {}
): FingerprintFit | null {
  const { tolSec, minLaps, minShare, minMarginLaps } = { ...DEFAULTS, ...opts };
  const starts = cumulativeStarts(laps);
  const crossings = [...new Set(crossingsSec)].sort((a, b) => a - b);
  if (starts.length < 2 || crossings.length < minLaps) return null;

  const spanFrom = crossings[0]!;
  const spanTo = crossings[crossings.length - 1]!;

  // Every way the sequence could sit: each of their laps laid over each crossing in turn. Rounded
  // to a hundredth so the same placement reached from two laps is tried once.
  const offsets = new Set<number>();
  for (const s of starts) {
    for (const t of crossings) offsets.add(Math.round((t - s.atSec) * 100) / 100);
  }

  const scored: Score[] = [];
  for (const offsetSec of offsets) {
    const sc = score(starts, crossings, offsetSec, spanFrom, spanTo, tolSec);
    if (sc.matched > 0) scored.push(sc);
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.weight - a.weight);

  const top = scored[0]!;
  if (!top.best) return null;

  const runnerUp = scored.find((s) => Math.abs(s.offsetSec - top.offsetSec) > SAME_ANSWER_SEC);
  const marginLaps = top.weight - (runnerUp?.weight ?? 0);

  const needed = Math.max(minLaps, Math.ceil(top.of * minShare));
  if (top.matched < needed || marginLaps < minMarginLaps) return null;

  // Re-centre on every matched lap rather than resting on whichever crossing was tried first: the
  // detector is a frame or two out either way, and the middle of a dozen readings is better than
  // any one of them.
  const drift = median(top.errors);
  const centred = score(starts, crossings, top.offsetSec + drift, spanFrom, spanTo, tolSec);
  const fit = centred.weight >= top.weight && centred.best ? centred : top;

  return {
    lapOneStartSec: fit.offsetSec,
    anchorLapNumber: fit.best!.lapNumber,
    anchorVideoTimeSec: fit.best!.crossingSec,
    matched: fit.matched,
    of: fit.of,
    medianErrorSec: median(fit.errors.map(Math.abs)),
    marginLaps,
  };
}
