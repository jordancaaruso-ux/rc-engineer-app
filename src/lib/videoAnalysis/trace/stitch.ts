/**
 * The chains of a lap made into one record.
 *
 * Positions are normalised to the frame the way sector lines are, so a proxy and the master
 * carry the same numbers. Every crossing with a position is measured against, from the path's
 * own points on either side of it: a chain forced through the crossing tells you nothing by
 * passing through it, so the check is where the blobs just before and after would put the car
 * at that moment. That is the free check the founder named: the crossing scan and the tracer
 * measured the same instant independently.
 */

import {
  LAP_TRACE_VERSION,
  type DriverRole,
  type ManualLapTrace,
  type TraceHole,
  type TracePoint,
  type TraceSegment,
} from "@/lib/manualVideoAnalysis/types";
import type { ChainAnchor, ChainPoint, ChainResult, ObsFrame } from "./chain";

export const TRACE_RECIPE = "trace-v1";
/**
 * A lap is drawn when at least this share of its frames placed the car... A stretch the tracer
 * could not follow is a hole, drawn as a break, so a lap with holes is honest rather than wrong;
 * the crossings rule below is what catches a chain that went with the wrong car.
 */
export const OK_COVERAGE = 0.6;
/** ...and the path lands within this many car lengths of every crossing but one. */
export const ANCHOR_HIT_CAR_LENGTHS = 1.0;
/**
 * How far a stretch's path may sit from a crossing it was pinned to before that end counts as
 * unmet, in car lengths. Looser than the bar a whole lap is judged on: one end being off is
 * ordinary, both ends being off is a different claim.
 */
export const SEGMENT_ANCHOR_REACH = 2.0;

/**
 * Did this stretch's path go anywhere near either of the crossings it runs between?
 *
 * Both crossings are known from the scan and the chain is pinned to them, so a path that comes
 * close to neither is not a path through this stretch — it is something else moving, which the
 * chain preferred to a run of misses and then abandoned before the far end. On the Bendigo
 * footage, 2026-09-07, the far sector of one lap came back looking beautiful: a smooth line
 * running steadily right for a second and a half. It was a car — just not this one, and it
 * covered twice the ground this sector holds. Neither end was met, and nothing else said so.
 */
export function segmentUnverified(seg: TraceSegment): boolean {
  if (seg.pinned?.from !== true || seg.pinned?.to !== true) return false;
  const missed = (e: number | null) => e == null || e > SEGMENT_ANCHOR_REACH;
  return missed(seg.anchorErr.from) && missed(seg.anchorErr.to);
}
/** Points further than this from the crossing's moment say nothing about it. */
const ANCHOR_REACH_SEC = 0.15;

export type StitchAnchor = { lineKey: string; t: number; x: number | null; y: number | null };

/**
 * Where the path puts the car at the anchor's moment, from the nearest points on the given side,
 * against where the crossing scan put it, in car lengths. Null when the path has no point close
 * enough, or the anchor has no position.
 */
export function anchorError(
  points: ReadonlyArray<Pick<ChainPoint, "t" | "x" | "y">>,
  anchor: ChainAnchor,
  carPx: number,
  side: "before" | "after"
): number | null {
  if (anchor.x == null || anchor.y == null) return null;
  const near = points
    .filter(
      (p) =>
        (side === "before" ? p.t <= anchor.t : p.t >= anchor.t) &&
        Math.abs(p.t - anchor.t) <= ANCHOR_REACH_SEC
    )
    .sort((a, b) => Math.abs(a.t - anchor.t) - Math.abs(b.t - anchor.t));
  const a = near[0];
  if (!a) return null;
  const b = near[1];
  let x = a.x;
  let y = a.y;
  if (b && b.t !== a.t) {
    // Two points give a heading; carry the nearer one to the anchor's moment along it.
    const k = (anchor.t - a.t) / (b.t - a.t);
    x = a.x + (b.x - a.x) * k;
    y = a.y + (b.y - a.y) * k;
  }
  return Math.hypot(x - anchor.x, y - anchor.y) / carPx;
}

export function stitchTrace(opts: {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  frame: { w: number; h: number };
  startSec: number;
  endSec: number;
  /** Every crossing of the lap in time order, the start line first and last. */
  anchors: StitchAnchor[];
  chains: ChainResult[];
  /** Every frame read, in time order. */
  frames: ObsFrame[];
  /** Video times of the frames thrown out as camera movement. */
  shookAt?: number[];
  carPxAt: (t: number) => number;
  /** The reader could not keep up; nothing here is to be trusted for drawing. */
  starved?: boolean;
  at?: string;
}): ManualLapTrace {
  const { frame } = opts;
  const all: ChainPoint[] = [];
  const holes: TraceHole[] = [];
  let ambiguousFrames = 0;
  for (const c of opts.chains) {
    all.push(...c.points);
    for (const h of c.holes) holes.push({ fromT: h.fromT, toT: h.toT, why: h.why });
    ambiguousFrames += c.ambiguousFrames;
  }
  all.sort((a, b) => a.t - b.t);
  const points: TracePoint[] = [];
  const kept: ChainPoint[] = [];
  for (const p of all) {
    if (kept.length && p.t <= kept[kept.length - 1]!.t) continue;
    kept.push(p);
    points.push([p.t, p.x / frame.w, p.y / frame.h, p.w / frame.w, p.h / frame.h]);
  }

  const segments: TraceSegment[] = [];
  const hit = new Map<number, boolean>();
  const note = (a: StitchAnchor, err: number | null) => {
    if (a.x == null || a.y == null) return;
    hit.set(a.t, (hit.get(a.t) ?? false) || (err != null && err <= ANCHOR_HIT_CAR_LENGTHS));
  };
  for (let i = 0; i < opts.anchors.length - 1; i++) {
    const from = opts.anchors[i]!;
    const to = opts.anchors[i + 1]!;
    const mine = opts.frames.filter((f) => f.t > from.t && f.t <= to.t);
    const read = mine.length;
    const saw = mine.filter((f) => f.blobs.length > 0).length;
    const shake = (opts.shookAt ?? []).filter((t) => t > from.t && t <= to.t).length;
    const placed = kept.filter((p) => p.t > from.t && p.t <= to.t).length;
    const fromErr = anchorError(kept, from, opts.carPxAt(from.t), "after");
    const toErr = anchorError(kept, to, opts.carPxAt(to.t), "before");
    note(from, fromErr);
    note(to, toErr);
    segments.push({
      fromKey: from.lineKey,
      toKey: to.lineKey,
      fromT: from.t,
      toT: to.t,
      coverage: read ? placed / read : 0,
      anchorErr: { from: fromErr, to: toErr },
      frames: { read, saw, shake },
      pinned: { from: from.x != null && from.y != null, to: to.x != null && to.y != null },
    });
  }

  const anchorsTotal = hit.size;
  const anchorsHit = [...hit.values()].filter(Boolean).length;
  const coverage = opts.frames.length ? kept.length / opts.frames.length : 0;
  return {
    version: LAP_TRACE_VERSION,
    at: opts.at ?? new Date().toISOString(),
    sessionId: opts.sessionId,
    driverRole: opts.driverRole,
    lapNumber: opts.lapNumber,
    frame: { w: frame.w, h: frame.h },
    startSec: opts.startSec,
    endSec: opts.endSec,
    points,
    holes: holes.sort((a, b) => a.fromT - b.fromT),
    segments,
    quality: {
      coverage,
      anchorsHit,
      anchorsTotal,
      ambiguousFrames,
      ok: !opts.starved && coverage >= OK_COVERAGE && anchorsHit >= anchorsTotal - 1,
    },
    recipe: TRACE_RECIPE,
  };
}
