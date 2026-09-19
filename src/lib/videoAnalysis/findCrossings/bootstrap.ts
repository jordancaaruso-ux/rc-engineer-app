/**
 * Work out where the corners are, and which car is yours, without a single mark.
 *
 * The detector only ever needs one thing it cannot read off the timing sheet: how long after a lap
 * start this driver reaches each line. Five numbers per track. Marking a lap by hand is just the
 * bluntest way to hand them over.
 *
 * They can be measured instead, and the reason is that **your lap times are irregular**. Read a
 * few whole laps rather than narrow windows and every line offers several crossings — your car,
 * and whoever else went through. Your car's crossings sit at the same offset from *your* lap
 * starts every lap; another car's do not, because their laps are a different length, so they walk
 * out of step. Over four laps a rival a quarter of a second quicker has drifted a second; the
 * right offset is the one that keeps repeating.
 *
 * Two supports make that reliable rather than merely likely:
 *
 *  - **Colour.** The start/finish crossings are identified by the transponder, so the colour of
 *    the thing that moved there is your car by definition. A candidate of the wrong colour is
 *    somebody else, however consistent it looks.
 *  - **Track order.** The five offsets have to come out in a sensible order with sensible gaps.
 *    A set of candidates that individually look fine but collectively describe an impossible lap
 *    is not the answer.
 *
 * ## The case this cannot settle on its own
 *
 * A rival you follow at a near-constant gap for the whole race. Their crossings repeat just as
 * faithfully as yours, one fixed offset away, and colour only helps if they are a different
 * colour. That is reported as an ambiguity with both candidates and their times, for the driver
 * to resolve with one tap — never guessed at. A whole session quietly attributed to the wrong car
 * is the one failure worth interrupting for.
 *
 * The 2026-07 attempt at this failed, and is worth remembering: clustering offsets across a
 * session locked onto a wrong-but-equally-consistent group. It failed because the detector was
 * then drowning in colour noise and fake candidates cluster too. What is different now is that
 * the candidates are real (per-line calibration), coherent (tracking), and colour-checked.
 */

import {
  chromaDistance,
  chromaOf,
  referenceColour,
  separation,
  toleranceFor,
  type CarColour,
  type Rgb,
} from "./carColour";
import type { CarColours } from "./field";
import { roleOf, SF_LINE_KEY, targetId, type SessionRole, type SessionTarget } from "./fromSession";
import type { CrossingEvent } from "./types";

/** How far apart two laps' offsets may be and still be the same corner. */
const CLUSTER_TOL_SEC = 0.8;
/** A rival's cluster this much weaker than the winner is not worth interrupting the driver for. */
const AMBIGUOUS_RATIO = 0.75;
/** Fewest laps a cluster must appear in before it can be believed at all. */
const MIN_LAPS_IN_CLUSTER = 2;
/** Laps read in full to learn the offsets. More is safer and slower; four separates well. */
export const BOOTSTRAP_LAPS = 4;

export type BootstrapLap = {
  role: SessionRole;
  lapNumber: number;
  startSec: number;
  lapTimeSec: number;
};

/** One crossing the full-lap scan turned up, wherever in the lap it fell. */
export type Candidate = {
  role: SessionRole;
  lapNumber: number;
  lineKey: string;
  t: number;
  quality: number;
  colour?: Rgb;
  /**
   * Passed the "moves like a car" test. An untracked candidate is a raw frame-pair flicker, and
   * on a line over painted kerbing there are a dozen of those per lap — enough that two of them
   * coincide across laps by chance and teach the bootstrap a corner that does not exist.
   */
  tracked: boolean;
};

export type LineVerdict = {
  lineKey: string;
  /** Chosen offset from lap start, in seconds. */
  offsetSec: number;
  /** How many of the read laps agreed. */
  laps: number;
  /** Mean colour distance from the reference car, when there is one. */
  colourDistance: number | null;
  /** A rival good enough that the driver should decide. */
  rival: { offsetSec: number; laps: number; colourDistance: number | null } | null;
};

/**
 * What each line offered and what became of it.
 *
 * Kept because "found nothing" has several very different causes — no candidates at all, plenty
 * of candidates that never repeat, or a good answer thrown out by a later sanity rule — and they
 * want opposite fixes. Without this the only symptom is a blank screen.
 */
export type LineDiagnostic = {
  lineKey: string;
  /** Crossings on offer across the read laps. */
  offers: number;
  /** Laps the winning cluster appeared in. */
  bestLaps: number;
  bestOffsetSec: number | null;
  colourDistance: number | null;
  outcome: "resolved" | "ambiguous" | "no-candidates" | "never-repeats" | "impossible";
};

export type BootstrapResult = {
  seeds: Record<string, number>;
  verdicts: LineVerdict[];
  /** Lines where a second candidate is too close to call. */
  ambiguous: LineVerdict[];
  /** Lines with nothing repeatable at all. */
  unresolved: string[];
  car: CarColour | null;
  diagnostics: LineDiagnostic[];
};

/**
 * Targets that read whole laps rather than windows — the search with nothing assumed.
 *
 * A little is trimmed off each end so the crossings that belong to the neighbouring laps do not
 * pile up at the edges of this one.
 */
export function bootstrapTargets(
  laps: BootstrapLap[],
  cornerKeys: string[],
  durationSec: number
): SessionTarget[] {
  const out: SessionTarget[] = [];
  for (const lap of laps) {
    const from = Math.max(0, lap.startSec + 0.05);
    const to = Math.min(durationSec, lap.startSec + lap.lapTimeSec - 0.05);
    if (to - from < 1) continue;
    for (const lineKey of cornerKeys) {
      out.push({
        id: targetId(lap.role, lap.lapNumber, lineKey),
        role: lap.role,
        lineKey,
        lapNumber: lap.lapNumber,
        centerSec: (from + to) / 2,
        truthSec: null,
        searchFrom: from,
        searchTo: to,
      });
    }
  }
  return out;
}

/** Flatten a full-lap scan's candidate lists into one list of offers. */
export function candidatesFrom(
  results: Array<{
    id: string;
    lineKey: string;
    lapNumber: number;
    candidates: CrossingEvent[];
    candidateColours?: Array<Rgb | undefined>;
    colour?: Rgb;
    source?: "confirmed" | "rescued" | "unconfirmed" | null;
  }>
): Candidate[] {
  const out: Candidate[] = [];
  for (const r of results) {
    const role = roleOf(r.id);
    r.candidates.forEach((c, i) => {
      out.push({
        role,
        lapNumber: r.lapNumber,
        lineKey: r.lineKey,
        t: c.t,
        quality: c.quality,
        tracked: r.source !== "unconfirmed",
        // Each candidate's own colour. A window with two candidates usually has two cars in it,
        // and those are precisely the ones that need telling apart — so the chosen crossing's
        // colour must not stand in for the rest.
        colour: r.candidateColours?.[i] ?? r.colour,
      });
    });
  }
  return out;
}

/**
 * The colour of the car whose lap times these are.
 *
 * Taken from the start/finish crossings only. Those are not guesses — the transponder says when
 * this driver went through, so whatever moved there is theirs.
 */
export function carColourFromLapStarts(
  sfResults: Array<{ lineKey: string; detectedSec: number | null; colour?: Rgb }>
): CarColour | null {
  const samples = sfResults
    .filter((r) => r.lineKey === SF_LINE_KEY && r.detectedSec != null && r.colour)
    .map((r) => r.colour!);
  return referenceColour(samples);
}

/**
 * Another car this close to the chosen crossing shares the picture with it, and the sample may be
 * either of them: not a moment to learn from. Further than this it is a different car — the
 * transponder put OURS at the pick — and so a measurement of what "not our car" looks like.
 */
const NOT_ALONE_SEC = 0.25;

/**
 * A reference colour per scanned driver, learnt the way identical-animal trackers learn a fish:
 * only from moments the car is on its own, and measured against the other cars seen beside it.
 *
 * The start/finish crossings are transponder-identified, so the thing that moved at the pick is
 * this driver's car by definition. Every OTHER candidate in that window is, by the same token,
 * somebody else — free evidence of what the rivals look like. `separation` records how far they
 * sit from the reference in units of its own scatter; until that clears `USABLE_SEPARATION`,
 * nothing downstream lets colour decide anything.
 */
export function carColoursFromLapStarts(
  sfResults: Array<{
    id: string;
    lineKey: string;
    detectedSec: number | null;
    colour?: Rgb;
    candidates?: CrossingEvent[];
  }>
): CarColours {
  const out: CarColours = {};
  // Whoever the pass actually read, not a fixed pair: practice footage can carry a third and a
  // fourth driver, and each needs their own reference or the field matching judges them all
  // against one car's paint.
  for (const role of [...new Set(sfResults.map((r) => roleOf(r.id)))]) {
    const own: Rgb[] = [];
    const rivals: Rgb[] = [];
    for (const r of sfResults) {
      if (r.lineKey !== SF_LINE_KEY || r.detectedSec == null || !r.colour) continue;
      if (r.id.split(":")[0] !== role) continue;
      const others = (r.candidates ?? []).filter((c) => Math.abs(c.t - r.detectedSec!) > 0.01);
      if (others.some((c) => Math.abs(c.t - r.detectedSec!) < NOT_ALONE_SEC)) continue;
      own.push(r.colour);
      for (const c of others) if (c.colour) rivals.push(c.colour);
    }
    const ref = referenceColour(own);
    if (ref) out[role] = { ...ref, separation: separation(ref, rivals) };
  }
  return out;
}

type Cluster = { offsets: number[]; laps: Set<string>; colours: Rgb[]; quality: number };

/** One crossing on offer, expressed as how far into its lap it happened. */
type Offer = { lap: string; off: number; q: number; colour?: Rgb };

function clusterFor(offsets: Offer[], seed: number): Cluster {
  const c: Cluster = { offsets: [], laps: new Set(), colours: [], quality: 0 };
  for (const o of offsets) {
    if (Math.abs(o.off - seed) > CLUSTER_TOL_SEC) continue;
    // One offer per lap: a lap with three candidates near the same place should not out-vote
    // three laps that each agree once.
    if (c.laps.has(o.lap)) continue;
    c.laps.add(o.lap);
    c.offsets.push(o.off);
    c.quality += o.q;
    if (o.colour) c.colours.push(o.colour);
  }
  return c;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Decide each line's offset from candidates spread over several laps.
 *
 * Scoring is deliberately blunt — how many laps agree, then how well the colour matches, then
 * how confident the detector was. A cleverer weighting would be fitted to this footage, and the
 * whole point is that the answer should fall out of repetition rather than tuning.
 */
export function resolveOffsets(opts: {
  laps: BootstrapLap[];
  candidates: Candidate[];
  car: CarColour | null;
  cornerKeys: string[];
}): BootstrapResult {
  const { laps, candidates, car, cornerKeys } = opts;
  const startOf = new Map(laps.map((l) => [`${l.role}:${l.lapNumber}`, l.startSec]));

  const verdicts: LineVerdict[] = [];
  const ambiguous: LineVerdict[] = [];
  const unresolved: string[] = [];
  const seeds: Record<string, number> = {};
  const diagnostics: LineDiagnostic[] = [];

  for (const lineKey of cornerKeys) {
    const mine = candidates.filter((c) => c.lineKey === lineKey);
    // Learn from things that moved like a car wherever there are any; the flickers are only
    // consulted when a line produced nothing better, and then only so the screen has something
    // to show rather than a blank.
    const pool = mine.some((c) => c.tracked) ? mine.filter((c) => c.tracked) : mine;
    const offers: Offer[] = [];
    for (const c of pool) {
      const lap = `${c.role}:${c.lapNumber}`;
      const start = startOf.get(lap);
      if (start == null) continue;
      offers.push({ lap, off: c.t - start, q: c.quality, colour: c.colour });
    }

    if (!offers.length) {
      unresolved.push(lineKey);
      diagnostics.push({
        lineKey,
        offers: 0,
        bestLaps: 0,
        bestOffsetSec: null,
        colourDistance: null,
        outcome: "no-candidates",
      });
      continue;
    }

    // Every candidate is tried as the centre of its own cluster; the best-supported wins.
    const scored = offers
      .map((o) => {
        const c = clusterFor(offers, o.off);
        const colourDistance = car && c.colours.length
          ? mean(c.colours.map((x) => chromaDistance(car.chroma, chromaOf(x))))
          : null;
        return {
          offsetSec: mean(c.offsets),
          laps: c.laps.size,
          quality: c.quality,
          colourDistance,
          // Laps first, then colour, then detector confidence.
          score:
            c.laps.size * 100 +
            (colourDistance != null && car
              ? Math.max(0, 1 - colourDistance / toleranceFor(car)) * 40
              : 0) +
            Math.min(20, c.quality),
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.laps < MIN_LAPS_IN_CLUSTER) {
      unresolved.push(lineKey);
      diagnostics.push({
        lineKey,
        offers: offers.length,
        bestLaps: best?.laps ?? 0,
        bestOffsetSec: best?.offsetSec ?? null,
        colourDistance: best?.colourDistance ?? null,
        outcome: "never-repeats",
      });
      continue;
    }

    // The strongest candidate that is a genuinely different moment, not the same cluster again.
    const rival =
      scored.find((s) => Math.abs(s.offsetSec - best.offsetSec) > CLUSTER_TOL_SEC * 2) ?? null;
    // Only a genuine tie is worth interrupting for. The score mixes several things, but the one
    // that matters is how many laps agreed — a candidate that repeated on three laps against a
    // winner that repeated on four has already lost, and asking about it is noise.
    const isAmbiguous =
      rival != null &&
      rival.laps >= MIN_LAPS_IN_CLUSTER &&
      rival.laps >= best.laps &&
      rival.score >= best.score * AMBIGUOUS_RATIO;

    const verdict: LineVerdict = {
      lineKey,
      offsetSec: best.offsetSec,
      laps: best.laps,
      colourDistance: best.colourDistance,
      rival: isAmbiguous
        ? { offsetSec: rival!.offsetSec, laps: rival!.laps, colourDistance: rival!.colourDistance }
        : null,
    };
    verdicts.push(verdict);
    seeds[lineKey] = best.offsetSec;
    if (isAmbiguous) ambiguous.push(verdict);
    diagnostics.push({
      lineKey,
      offers: offers.length,
      bestLaps: best.laps,
      bestOffsetSec: best.offsetSec,
      colourDistance: best.colourDistance,
      outcome: isAmbiguous ? "ambiguous" : "resolved",
    });
  }

  return settleByOrder(
    { seeds, verdicts, ambiguous, unresolved, car, diagnostics },
    cornerKeys
  );
}

/**
 * Break a genuine tie using where the corner sits in the lap.
 *
 * The lines come in the order the driver drew them, which for a set of sector lines is the order
 * they are met on track. So when two candidates are equally consistent, the one that lands between
 * its neighbours is the corner and the other is somebody else's car passing a different part of
 * the circuit — measured on real footage, one line's runner-up sat between the two corners BEFORE
 * it, which is not a place that corner can be.
 *
 * Only used to settle a tie, never to override a clear winner: if the lines were drawn out of
 * order this can be wrong, and in that case the alternative was interrupting the driver anyway.
 */
function settleByOrder(result: BootstrapResult, cornerKeys: string[]): BootstrapResult {
  if (!result.ambiguous.length) return result;

  const rank = new Map(cornerKeys.map((k, i) => [k, i]));
  const settled = new Set(
    result.verdicts.filter((v) => v.rival == null).map((v) => v.lineKey)
  );
  const offsetOf = new Map(result.verdicts.map((v) => [v.lineKey, v.offsetSec]));

  const fits = (lineKey: string, off: number): boolean => {
    const mine = rank.get(lineKey)!;
    for (const other of settled) {
      const theirs = rank.get(other)!;
      const t = offsetOf.get(other)!;
      if (theirs < mine && off <= t) return false;
      if (theirs > mine && off >= t) return false;
    }
    return true;
  };

  const stillAmbiguous: LineVerdict[] = [];
  const seeds = { ...result.seeds };
  for (const v of result.ambiguous) {
    const bestFits = fits(v.lineKey, v.offsetSec);
    const rivalFits = fits(v.lineKey, v.rival!.offsetSec);
    if (bestFits === rivalFits) {
      stillAmbiguous.push(v);
      continue;
    }
    const winner = bestFits ? v.offsetSec : v.rival!.offsetSec;
    seeds[v.lineKey] = winner;
    v.offsetSec = winner;
    v.rival = null;
  }

  return {
    ...result,
    seeds,
    ambiguous: stillAmbiguous,
    diagnostics: result.diagnostics.map((d) =>
      d.outcome === "ambiguous" && !stillAmbiguous.some((a) => a.lineKey === d.lineKey)
        ? { ...d, outcome: "resolved" as const }
        : d
    ),
  };
}

/**
 * Sanity-check the whole set together: the offsets must describe a lap that could be driven.
 *
 * Individually plausible answers can still be collectively nonsense — two lines resolving to the
 * same moment, or an offset past the end of the lap. Anything that fails goes back to unresolved
 * rather than being quietly used.
 */
export function pruneImpossible(
  result: BootstrapResult,
  medianLapTimeSec: number
): BootstrapResult {
  const kept = [...result.verdicts].sort((a, b) => a.offsetSec - b.offsetSec);
  const dropped: string[] = [];
  const final: LineVerdict[] = [];

  for (const v of kept) {
    if (v.offsetSec < 0 || v.offsetSec > medianLapTimeSec * 1.5) {
      dropped.push(v.lineKey);
      continue;
    }
    const previous = final[final.length - 1];
    // Two corners cannot share a moment. The weaker of the pair is the one to lose, and `kept`
    // is in time order, so compare against what is already accepted.
    if (previous && v.offsetSec - previous.offsetSec < 0.15) {
      if (v.laps > previous.laps) {
        dropped.push(previous.lineKey);
        final[final.length - 1] = v;
      } else {
        dropped.push(v.lineKey);
      }
      continue;
    }
    final.push(v);
  }

  const seeds: Record<string, number> = {};
  for (const v of final) seeds[v.lineKey] = v.offsetSec;
  return {
    ...result,
    seeds,
    verdicts: final,
    ambiguous: result.ambiguous.filter((a) => seeds[a.lineKey] != null),
    unresolved: [...result.unresolved, ...dropped],
  };
}
