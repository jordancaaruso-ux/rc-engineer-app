/**
 * Which of these paths was whose car — answered by the timing sheet, not by the picture.
 *
 * This is the step the whole rebuild turns on. Every earlier attempt asked the picture who a car
 * was: how it was coloured, whether it kept step with a prediction, whether something was present
 * when the driver was due. Each of those is a guess dressed as evidence, and each failed the same
 * way — a person standing beside the track beat a car, because a person is always present.
 *
 * The sheet is not a guess. It says, to a thousandth, the moment every driver crossed the start
 * line on every lap. So: take each path's own crossings of the start line and match them to those
 * moments. A path that lines up with Cooper's crossings, lap after lap, is Cooper's car. **A path
 * that lines up with nobody's is nobody** — a marshal, a spectator, a flag, the board — and it is
 * thrown away rather than argued with. That is the whole idea, and it costs a person nothing to
 * stand still all afternoon because standing still has no lap times.
 *
 * Four things follow from it that the old design could not have:
 *
 *  - **Every lap is checked.** Two consecutive crossings should be exactly the sheet's lap time
 *    apart. When they are not, that lap is marked unsure rather than reported as fact.
 *  - **A swap shows up within a lap.** If a path's crossings start fitting somebody else, the
 *    path is cut there. It cannot run on silently as the wrong driver.
 *  - **Shade is survivable.** A car that vanishes into tree shade at the start line leaves a path
 *    ending just before it and another starting just after. Where the full-resolution strip saw
 *    the crossing between them, the two are joined *through that crossing* — so the one place the
 *    coarse picture is blindest is the one place another instrument is looking.
 *  - **A wrong sync says so.** If the sheet and the footage disagree about where the race even is,
 *    almost nothing lines up, and the pass writes nothing at all. A wrong anchor must never
 *    produce confident wrong names.
 *
 * Pure: tracklets and a sheet in, named laps out.
 */

import { hungarian } from "../findCrossings/field";
import { lineGeom } from "../findCrossings/geometry";
import type { SessionRole } from "../findCrossings/fromSession";
import type { SectorLine } from "../findCrossings/types";
import type { Obs } from "../trace/chain";
import type { Tracklet } from "./link";
import {
  crossingsAgainst,
  snapToStrip,
  type CrossingSource,
  type SnappedCrossing,
  type StripCandidate,
} from "./pathCrossings";

/** One driver as the timing sheet has them, placed on the video clock. */
export type SheetDriver = {
  /** Stable key: the seated role for a driver being analysed, the timing key otherwise. */
  key: string;
  name: string;
  /** Set only for drivers with a seat in the analysis; the rest are the rest of the field. */
  role?: SessionRole;
  laps: Array<{
    lapNumber: number;
    /** Where the walked transponder clock puts this lap's start on the video. */
    startSec: number;
    /** The sheet's own duration for this lap — the fact that checks a measured pair. */
    lapTimeSec: number;
  }>;
};

/**
 * How far from the walked clock a crossing may sit and still be that driver's, before anything
 * has been measured.
 *
 * Wide, because the walk is known to drift: on the Bendigo practice of 2026-09-01 the chain of
 * crossings slid from +1.71 s to +0.74 s over nine laps, most of it in one step where the sheet
 * called a lap half a second longer than the footage did (`lapClock.ts`). A gate tight enough for
 * a good clock would refuse every lap after that step.
 */
export const NAME_GATE_FIRST_SEC = 1.2;

/**
 * …and how far once this driver has one measured crossing to walk from instead.
 *
 * From a measured moment the sheet's lap times are accurate to milliseconds, so a third of a
 * second is already generous. This is what separates two drivers on similar lap times.
 */
export const NAME_GATE_SEC = 0.35;

/**
 * A measured pair of crossings should be the sheet's lap time apart, to this.
 *
 * The transponder gate the pipeline already validates against (`compareTransponder.ts`). Inside
 * it, the footage and the sheet agree about that lap; outside, one of the two is wrong and the
 * lap is marked rather than believed.
 */
export const CLOCK_GATE_SEC = 0.15;

/** A path ending this soon before the line, and one starting this soon after, may be one car. */
export const BRIDGE_SEC = 0.6;

/** …if they are also about the same size. */
export const BRIDGE_SIZE_LO = 0.6;
export const BRIDGE_SIZE_HI = 1.6;

/** …and the strip's crossing between them is no further off their join than this, in car lengths. */
export const BRIDGE_OFF_LINE_CAR_LENGTHS = 2;

/**
 * How near another driver has to fit before naming is a coin toss rather than a reading.
 *
 * Per crossing. Two cars genuinely nose to tail are a tenth apart at the line and no timing can
 * separate them; the answer is to say so, not to pick one. This is the same reasoning as the
 * field matcher's claim margin, which exists for the same situation.
 */
export const TIE_MARGIN_SEC = 0.1;

/**
 * Below this share of the sheet's slots filled, the footage and the sheet are not describing the
 * same thing and nothing is written.
 */
export const MIN_NAMED_SHARE = 0.5;

/** A pairing this far outside the gate is never chosen; finite so the solver's arithmetic holds. */
const FORBIDDEN = 1e6;
/** Leaving a crossing unnamed, or a slot empty, costs one gate — so anything inside beats both. */
const UNMATCHED = 1;

/** One time a path went over the start line. */
export type SfPass = {
  trackletId: number;
  crossing: SnappedCrossing;
};

export type NamedLap = {
  key: string;
  name: string;
  role?: SessionRole;
  lapNumber: number;
  /** Measured video time this lap started — the crossing, not the walk. */
  startSec: number;
  endSec: number;
  startSource: CrossingSource;
  endSource: CrossingSource;
  /**
   * Every sighting of this driver's car inside this lap, from every path they were named on,
   * in time order. A stretch where two cars touched is simply missing from it.
   */
  points: Obs[];
  /** Both ends came off ONE unbroken path, so the lap was never in doubt at all. */
  pathComplete: boolean;
  trackletId: number | null;
  /** The two crossings are the sheet's lap time apart, inside the transponder gate. */
  sfMatched: boolean;
  /** Measured length minus the sheet's, seconds. Positive means the footage says it took longer. */
  sfErrorSec: number | null;
};

export type NameTie = {
  trackletId: number;
  /** The drivers it fitted equally well. */
  between: string[];
  passes: number;
};

export type NameResult = {
  laps: NamedLap[];
  ties: NameTie[];
  /** Paths that matched nobody's crossings — people, marshals, flags, the board. */
  unnamed: number;
  /** Paths whose crossings fitted more than one driver in turn, and were cut. */
  cuts: number;
  /** Paths joined through the strip's crossing at the start line. */
  bridged: number;
  /** Share of the sheet's (driver, lap) starts that got a measured crossing. */
  namedShare: number;
  sheetCheck: { laps: number; medianMs: number; worstMs: number } | null;
  verdict: "ok" | "doesnt-line-up";
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/**
 * Join two paths through the start line when the coarse picture lost the car there but the
 * full-resolution strip did not.
 *
 * The Bendigo start/finish sits in deep tree shade, which is exactly where a quarter-scale
 * difference against a still picture has least to work with — and it is the one place in the lap
 * where being blind costs a whole lap its identity. The strip reads that line at full resolution
 * with its own calibrated gate and finds the crossing there routinely (its start-line times agree
 * with the transponder to about a millisecond on this footage). So the join is not an assumption
 * about what happened in the gap: it is anchored on another instrument's reading of the moment.
 *
 * The gap itself is never drawn. The joined path keeps both halves' points and nothing between.
 */
function bridgeAcrossLine(
  tracklets: Tracklet[],
  candidates: ReadonlyArray<StripCandidate>,
  carPx: number
): { tracklets: Tracklet[]; bridged: number } {
  if (!candidates.length) return { tracklets, bridged: 0 };
  const byStart = [...tracklets].sort((a, b) => a.points[0]!.t - b.points[0]!.t);
  const used = new Set<number>();
  const merged = new Map<number, Tracklet>();
  let bridged = 0;

  for (const a of byStart) {
    if (used.has(a.id)) continue;
    const aEnd = a.points[a.points.length - 1]!;
    for (const b of byStart) {
      if (b.id === a.id || used.has(b.id)) continue;
      const bStart = b.points[0]!;
      const gap = bStart.t - aEnd.t;
      if (gap <= 0 || gap > BRIDGE_SEC) continue;
      const ratio = b.sizePx / (a.sizePx || 1);
      if (ratio < BRIDGE_SIZE_LO || ratio > BRIDGE_SIZE_HI) continue;
      // A crossing of the line, from the strip, in the gap and on the way between the two ends.
      const bar = BRIDGE_OFF_LINE_CAR_LENGTHS * carPx;
      const hit = candidates.find((c) => {
        if (c.t <= aEnd.t || c.t >= bStart.t) return false;
        if (c.x == null || c.y == null) return true;
        const k = (c.t - aEnd.t) / gap;
        const jx = aEnd.x + (bStart.x - aEnd.x) * k;
        const jy = aEnd.y + (bStart.y - aEnd.y) * k;
        return Math.hypot(c.x - jx, c.y - jy) <= bar;
      });
      if (!hit) continue;
      const joined: Tracklet = {
        id: a.id,
        points: [...a.points, ...b.points],
        sizePx: (a.sizePx + b.sizePx) / 2,
        gaps: a.gaps + b.gaps,
        startedBy: a.startedBy,
        endedBy: b.endedBy,
        doubts: [...a.doubts, ...b.doubts],
      };
      merged.set(a.id, joined);
      used.add(b.id);
      bridged++;
      break;
    }
  }
  if (!bridged) return { tracklets, bridged: 0 };
  return {
    tracklets: tracklets.filter((t) => !used.has(t.id)).map((t) => merged.get(t.id) ?? t),
    bridged,
  };
}

/**
 * Where each of this driver's laps starts, once one of them has actually been measured.
 *
 * The walked clock is one anchor plus every lap time added up, so a single wrong lap time is
 * carried for the rest of the session. From a measured crossing the same sums are only ever a few
 * laps long, so they stay accurate — which is what lets the gate close from over a second to a
 * third of one, and that is what separates two drivers on similar lap times.
 */
function predictedStarts(driver: SheetDriver, measured: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  if (!measured.size) return out;
  const laps = [...driver.laps].sort((a, b) => a.lapNumber - b.lapNumber);
  const lapTime = new Map(laps.map((l) => [l.lapNumber, l.lapTimeSec]));
  for (const l of laps) {
    if (measured.has(l.lapNumber)) {
      out.set(l.lapNumber, measured.get(l.lapNumber)!);
      continue;
    }
    // Walk from the nearest measured lap, forward or back, through the sheet's own lap times.
    let best: { at: number; distance: number } | null = null;
    for (const [lap, sec] of measured) {
      const distance = Math.abs(lap - l.lapNumber);
      if (best && distance >= best.distance) continue;
      let at = sec;
      let ok = true;
      if (l.lapNumber > lap) {
        for (let n = lap; n < l.lapNumber; n++) {
          const d = lapTime.get(n);
          if (d == null || d <= 0) {
            ok = false;
            break;
          }
          at += d;
        }
      } else {
        for (let n = lap - 1; n >= l.lapNumber; n--) {
          const d = lapTime.get(n);
          if (d == null || d <= 0) {
            ok = false;
            break;
          }
          at -= d;
        }
      }
      if (ok) best = { at, distance };
    }
    if (best) out.set(l.lapNumber, best.at);
  }
  return out;
}

type Slot = { driver: SheetDriver; lapNumber: number; at: number; gate: number };

/**
 * Most crossings the matching will consider.
 *
 * The solver is cubic in the size of the square it is given, so a pass over a noisy picture — a
 * windy day, a busy grandstand, a gate set too low — could hand it thousands of rows and lock the
 * tab solid rather than answer slowly. Measured on the first real run of the pass (2026-09-08,
 * before the coarse gate was calibrated on the coarse picture): 7 865 paths, of which 7 501 were
 * nobody. A crossing that fits nobody's slot cannot be matched to anything, so dropping it before
 * the matrix is built costs nothing at all and is what normally keeps this small; the cap is the
 * belt to that pair of braces.
 */
const MAX_PASSES = 400;

/** Minimum-cost matching of crossings to (driver, lap) slots, with both sides free to go empty. */
function assign(passes: SfPass[], slots: Slot[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!passes.length || !slots.length) return out;

  // Only the crossings that could belong to somebody. Everything else is a marshal, a flag or a
  // patch of grain going over the start line, and no arrangement makes it a lap.
  const fit = passes
    .map((p, i) => {
      let best = Infinity;
      for (const s of slots) {
        const d = Math.abs(p.crossing.t - s.at);
        if (d <= s.gate) best = Math.min(best, d / s.gate);
      }
      return { i, best };
    })
    .filter((x) => Number.isFinite(x.best))
    .sort((a, b) => a.best - b.best)
    .slice(0, MAX_PASSES);
  if (!fit.length) return out;

  const n = Math.max(fit.length, slots.length);
  const cost: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) {
      if (r >= fit.length || c >= slots.length) {
        row.push(UNMATCHED);
        continue;
      }
      const d = Math.abs(passes[fit[r]!.i]!.crossing.t - slots[c]!.at);
      row.push(d > slots[c]!.gate ? FORBIDDEN : d / slots[c]!.gate);
    }
    cost.push(row);
  }
  const match = hungarian(cost);
  for (let r = 0; r < fit.length; r++) {
    const c = match[r];
    if (c == null || c >= slots.length) continue;
    if (cost[r]![c]! >= UNMATCHED) continue;
    out.set(fit[r]!.i, c);
  }
  return out;
}

export type NameOptions = {
  tracklets: Tracklet[];
  /** The start/finish line as drawn. */
  sfLine: SectorLine;
  frameW: number;
  frameH: number;
  /** Everyone the sheet knows about, placed on the video clock. */
  sheet: SheetDriver[];
  /** What the full-resolution strip saw at the start line. */
  sfCandidates: StripCandidate[];
  /** The car's apparent length, full-frame pixels. */
  carPx: number;
};

/**
 * Name every path by the sheet, and say honestly what could not be named.
 */
export function nameByTheSheet(opts: NameOptions): NameResult {
  const { sfLine, frameW, frameH, sheet, sfCandidates, carPx } = opts;
  const g = lineGeom(sfLine, frameW, frameH);

  const { tracklets, bridged } = bridgeAcrossLine(opts.tracklets, sfCandidates, carPx);

  // Every time any path went over the start line, pinned to the strip's own reading where it saw
  // the same one.
  const passes: SfPass[] = [];
  const pointsOf = new Map<number, Obs[]>();
  for (const t of tracklets) {
    pointsOf.set(t.id, t.points);
    const raw = crossingsAgainst(t.points, g);
    if (!raw.length) continue;
    for (const c of snapToStrip(raw, sfCandidates, carPx)) {
      passes.push({ trackletId: t.id, crossing: c });
    }
  }
  passes.sort((a, b) => a.crossing.t - b.crossing.t);

  // Pass one: the walked clock, wide open, because the walk is known to drift.
  const wide: Slot[] = [];
  for (const d of sheet) {
    for (const l of d.laps) {
      wide.push({ driver: d, lapNumber: l.lapNumber, at: l.startSec, gate: NAME_GATE_FIRST_SEC });
    }
  }
  const first = assign(passes, wide);

  // Pass two: from what pass one measured, each driver's own clock, and a gate a third as wide.
  const measuredByDriver = new Map<string, Map<number, number>>();
  for (const [pi, si] of first) {
    const slot = wide[si]!;
    const m = measuredByDriver.get(slot.driver.key) ?? new Map<number, number>();
    m.set(slot.lapNumber, passes[pi]!.crossing.t);
    measuredByDriver.set(slot.driver.key, m);
  }
  const narrow: Slot[] = [];
  for (const d of sheet) {
    const predicted = predictedStarts(d, measuredByDriver.get(d.key) ?? new Map());
    for (const l of d.laps) {
      const at = predicted.get(l.lapNumber);
      narrow.push(
        at != null
          ? { driver: d, lapNumber: l.lapNumber, at, gate: NAME_GATE_SEC }
          : { driver: d, lapNumber: l.lapNumber, at: l.startSec, gate: NAME_GATE_FIRST_SEC }
      );
    }
  }
  const settled = assign(passes, narrow);

  // A path must be one driver's. Where its crossings fitted two in turn, the majority keeps it and
  // the rest are given up — the path has a swap in it and nothing may be carried across.
  const byTracklet = new Map<number, number[]>();
  for (const pi of settled.keys()) {
    const id = passes[pi]!.trackletId;
    const list = byTracklet.get(id) ?? [];
    list.push(pi);
    byTracklet.set(id, list);
  }
  let cuts = 0;
  const dropped = new Set<number>();
  for (const [id, list] of byTracklet) {
    const counts = new Map<string, number>();
    for (const pi of list) {
      const key = narrow[settled.get(pi)!]!.driver.key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size < 2) continue;
    cuts++;
    const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    for (const pi of list) {
      if (narrow[settled.get(pi)!]!.driver.key !== winner) dropped.add(pi);
    }
    void id;
  }

  // A path that fits somebody else just as well is not a reading. Two cars nose to tail are a
  // tenth apart at the line and no timing can separate them; saying so is the answer.
  const ties: NameTie[] = [];
  for (const [id, list] of byTracklet) {
    const live = list.filter((pi) => !dropped.has(pi));
    if (!live.length) continue;
    const mine = narrow[settled.get(live[0]!)!]!.driver.key;
    const myCost = live.reduce((s, pi) => {
      const slot = narrow[settled.get(pi)!]!;
      return s + Math.abs(passes[pi]!.crossing.t - slot.at);
    }, 0);
    const rivals: string[] = [];
    for (const d of sheet) {
      if (d.key === mine) continue;
      const predicted = predictedStarts(d, measuredByDriver.get(d.key) ?? new Map());
      let theirs = 0;
      let all = true;
      for (const pi of live) {
        let best = Infinity;
        for (const l of d.laps) {
          const at = predicted.get(l.lapNumber) ?? l.startSec;
          best = Math.min(best, Math.abs(passes[pi]!.crossing.t - at));
        }
        if (!Number.isFinite(best) || best > NAME_GATE_FIRST_SEC) {
          all = false;
          break;
        }
        theirs += best;
      }
      if (all && theirs <= myCost + TIE_MARGIN_SEC * live.length) rivals.push(d.key);
    }
    if (rivals.length) {
      ties.push({ trackletId: id, between: [mine, ...rivals], passes: live.length });
      for (const pi of live) dropped.add(pi);
    }
  }

  // What survives: a measured start-line moment per (driver, lap).
  type Placed = { pass: SfPass; slot: Slot };
  const placed = new Map<string, Placed>();
  for (const [pi, si] of settled) {
    if (dropped.has(pi)) continue;
    const slot = narrow[si]!;
    placed.set(`${slot.driver.key}:${slot.lapNumber}`, { pass: passes[pi]!, slot });
  }

  /**
   * Every path this driver was named on — and therefore every path that IS their car.
   *
   * A tracklet is one object from beginning to end; that is the linker's whole contract, and the
   * merge rule exists to keep it true. So a tracklet that lines up with one of this driver's
   * start-line crossings is this driver's car for the **whole** of its life, not merely at the
   * moment it was named.
   *
   * That matters more than it sounds. A lap whose path is cut in the middle — two cars touched,
   * and neither may carry identity through — used to be a lap with no path at all, because its
   * two ends sat on different tracklets. Measured on the Boronia race (2026-09-08), that left
   * **every one of 64 named laps without a racing line**, while the lap times themselves were
   * right to five milliseconds. The pieces were there the whole time; nothing was asking them.
   */
  const namedTracklets = new Map<string, Set<number>>();
  for (const p of placed.values()) {
    const set = namedTracklets.get(p.slot.driver.key) ?? new Set<number>();
    set.add(p.pass.trackletId);
    namedTracklets.set(p.slot.driver.key, set);
  }

  // A lap is the stretch between the crossing that opens it and the one that opens the next.
  const laps: NamedLap[] = [];
  const errors: number[] = [];
  for (const d of sheet) {
    const lapTime = new Map(d.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
    const mine = namedTracklets.get(d.key) ?? new Set<number>();
    for (const l of d.laps) {
      const open = placed.get(`${d.key}:${l.lapNumber}`);
      const close = placed.get(`${d.key}:${l.lapNumber + 1}`);
      if (!open || !close) continue;
      const startSec = open.pass.crossing.t;
      const endSec = close.pass.crossing.t;
      const expected = lapTime.get(l.lapNumber);
      const err = expected != null && expected > 0 ? endSec - startSec - expected : null;
      if (err != null) errors.push(Math.abs(err) * 1000);
      const sameTracklet = open.pass.trackletId === close.pass.trackletId;
      // The pieces of this driver's car inside this lap, biggest first, and **never two at once**.
      //
      // A driver can be named on several paths, and two of them can overlap in time — one is this
      // car and the other is a stretch that was wrongly given the same name, or the same car
      // followed twice through a patch of doubt. Simply pooling their points and sorting by time
      // interleaves two positions per moment, and the "path" then zigzags between two cars,
      // crossing every line in sight. Measured 2026-09-08 that showed up as lap coverage of 151 %
      // — more sightings than there were frames — and crossings a second and a half from the
      // truth. The piece that covers most of the lap wins; the rest may only fill what it leaves.
      const pieces = [...mine]
        .map((id) => ({ id, points: (pointsOf.get(id) ?? []).filter((p) => p.t >= startSec && p.t <= endSec) }))
        .filter((p) => p.points.length > 0)
        .sort((a, b) => b.points.length - a.points.length);
      const points: Obs[] = [];
      const taken: Array<{ from: number; to: number }> = [];
      for (const piece of pieces) {
        const from = piece.points[0]!.t;
        const to = piece.points[piece.points.length - 1]!.t;
        if (taken.some((r) => from <= r.to && to >= r.from)) continue;
        taken.push({ from, to });
        points.push(...piece.points);
      }
      points.sort((a, b) => a.t - b.t);
      laps.push({
        key: d.key,
        name: d.name,
        ...(d.role ? { role: d.role } : {}),
        lapNumber: l.lapNumber,
        startSec,
        endSec,
        startSource: open.pass.crossing.source,
        endSource: close.pass.crossing.source,
        points,
        pathComplete: sameTracklet && points.length > 0,
        trackletId: sameTracklet ? open.pass.trackletId : null,
        sfMatched: err != null && Math.abs(err) <= CLOCK_GATE_SEC,
        sfErrorSec: err,
      });
    }
  }

  const slotsWanted = sheet.reduce((s, d) => s + d.laps.length, 0);
  const namedShare = slotsWanted ? placed.size / slotsWanted : 0;
  const withAName = new Set<number>();
  for (const p of placed.values()) withAName.add(p.pass.trackletId);
  const unnamed = tracklets.length - withAName.size;

  return {
    laps: laps.sort((a, b) => a.startSec - b.startSec),
    ties,
    unnamed,
    cuts,
    bridged,
    namedShare,
    sheetCheck: errors.length
      ? { laps: errors.length, medianMs: median(errors), worstMs: Math.max(...errors) }
      : null,
    // Almost nothing lined up: the sheet and the footage are not describing the same thing, and a
    // wrong anchor must never be allowed to produce confident wrong names.
    verdict: namedShare < MIN_NAMED_SHARE ? "doesnt-line-up" : "ok",
  };
}
