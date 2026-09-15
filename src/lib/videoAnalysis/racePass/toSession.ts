/**
 * What the race pass leaves behind on the session.
 *
 * Four different things, and the difference between them matters:
 *
 *  - **Marks** are decisions. They are what the sector board reads, so only a crossing the pass is
 *    actually sure of becomes one — and only for a driver with a seat in the analysis. A cell the
 *    pass could not separate stays empty on purpose, for a hand mark or the strip fallback.
 *  - **Scan rows** are the evidence. Every crossing, every candidate it beat, and every line the
 *    pass could not answer, in the shape `lastScan` already uses — so `dev-replay-*` and the
 *    review panel read a race pass and a strip scan the same way.
 *  - **Traces** are the picture. A named lap with a path of its own is a racing line and a delta
 *    curve for free, with no per-lap "Trace this lap" press and no second decode.
 *  - **Measured lap starts** are the clock. The transponder walk drifts (`lapClock.ts`); a
 *    measured crossing does not, and writing it where every sector calculation already looks is
 *    what stops sector one silently absorbing the whole error.
 *
 * Pure: named laps and crossings in, session pieces out. Nothing here decides anything — every
 * judgement was made upstream, and this only files it.
 */

import type {
  DriverRole,
  ManualFrameMark,
  ManualLapTrace,
  ManualRaceRecord,
  ManualScanCandidate,
  ManualScanRow,
  RaceRecordDriver,
  TraceHole,
  TracePoint,
  TraceSegment,
} from "@/lib/manualVideoAnalysis/types";
import { LAP_TRACE_VERSION, traceKey } from "@/lib/manualVideoAnalysis/types";
import type { Obs } from "../trace/chain";
import type { LinkResult } from "./link";
import type { NameResult, NamedLap } from "./name";
import type { SectorCrossing, SectorResult } from "./sectorCrossings";

/** Which pass wrote a trace, so a later reader can tell it from the per-lap tracer's. */
export const RACE_RECIPE = "race-v1";

/**
 * A gap in a path longer than this is drawn as a break rather than a line.
 *
 * The same figure the chain uses for the same decision. Half a second at racing speed is several
 * car lengths, and a straight line across it would be an invention.
 */
export const HOLE_SEC = 0.5;

/** A lap seen in less than this share of its frames is not honest enough to draw. */
export const OK_COVERAGE = 0.6;

/**
 * Most bytes of traced paths to keep on one session.
 *
 * `manualJson` is read on every open of the job, so a race's worth of paths at full frame rate
 * would make the page slower for everyone to buy detail the chart cannot show. Over this, points
 * are thinned by taking every second one — a racing line and a delta curve do not need thirty
 * positions a second.
 */
export const MAX_TRACES_BYTES = 1_500_000;

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** A path as the store wants it: time, then everything else as a fraction of the frame. */
function tracePoints(points: ReadonlyArray<Obs>, frameW: number, frameH: number): TracePoint[] {
  return points.map((p) => [
    round(p.t, 3),
    round(p.x / frameW, 5),
    round(p.y / frameH, 5),
    round(p.w / frameW, 5),
    round(p.h / frameH, 5),
  ]);
}

function holesOf(points: ReadonlyArray<Obs>, holeSec: number): TraceHole[] {
  const out: TraceHole[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i]!.t - points[i - 1]!.t;
    if (gap > holeSec) out.push({ fromT: points[i - 1]!.t, toT: points[i]!.t, why: "lost" });
  }
  return out;
}

/** Typical gap between sightings, so coverage can be a share of frames rather than of seconds. */
function frameStep(points: ReadonlyArray<Obs>): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push(points[i]!.t - points[i - 1]!.t);
  if (!gaps.length) return 1 / 30;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] || 1 / 30;
}

function segmentsOf(
  lap: NamedLap,
  crossings: SectorCrossing[],
  sfKey: string,
  cornerKeys: string[],
  step: number
): TraceSegment[] {
  // The lap in order: start line, every corner that was read, start line again.
  const stops: Array<{ key: string; t: number; pinned: boolean }> = [
    { key: sfKey, t: lap.startSec, pinned: true },
  ];
  for (const key of cornerKeys) {
    const c = crossings.find((x) => x.lineKey === key);
    if (c) stops.push({ key, t: c.t, pinned: !c.unsure });
  }
  stops.push({ key: sfKey, t: lap.endSec, pinned: true });

  const out: TraceSegment[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]!;
    const to = stops[i]!;
    const span = to.t - from.t;
    if (!(span > 0)) continue;
    const seen = lap.points.filter((p) => p.t >= from.t && p.t <= to.t).length;
    const expected = Math.max(1, Math.round(span / step));
    out.push({
      fromKey: from.key,
      toKey: to.key,
      fromT: from.t,
      toT: to.t,
      coverage: Math.min(1, seen / expected),
      anchorErr: { from: null, to: null },
      pinned: { from: from.pinned, to: to.pinned },
    });
  }
  return out;
}

function toCandidates(cs: SectorCrossing["others"]): ManualScanCandidate[] {
  return cs.map((c) => ({
    t: c.t,
    quality: c.quality ?? 0,
    x: c.x,
    y: c.y,
    dir: c.dir,
    source: c.source,
  }));
}

export type ToSessionOptions = {
  sessionId: string;
  frameW: number;
  frameH: number;
  named: NameResult;
  sectors: SectorResult;
  linked: LinkResult;
  /** The start line's key, and the corner keys in the order they are met. */
  sfKey: string;
  cornerKeys: string[];
  /** Roles with a seat in this analysis. Only these get marks and traces. */
  seatedRoles: Set<DriverRole>;
  /** For the record: what was read and how long it took. */
  span: { fromSec: number; toSec: number };
  frames: number;
  readMs: number;
  scale: number;
  shakeFrames: number;
  at?: string;
};

export type SessionPieces = {
  /** Crossings sure enough to be decisions, for seated drivers only. */
  marks: ManualFrameMark[];
  /** Every crossing and every gap, as evidence. */
  rows: ManualScanRow[];
  /** One per seated driver's lap that kept a path. */
  traces: Record<string, ManualLapTrace>;
  /** Where each lap really started, measured. */
  measuredLapStarts: Array<{ role: DriverRole; lapNumber: number; videoTimeSec: number }>;
  record: ManualRaceRecord;
};

/**
 * File the pass's answers in the shapes the session already understands.
 *
 * A pass that decided the footage and the timing are not describing the same thing writes no
 * marks, no traces and no lap starts — only the record saying so. A wrong anchor must never be
 * allowed to produce confident wrong times.
 */
export function toSession(opts: ToSessionOptions): SessionPieces {
  const { named, sectors, linked, frameW, frameH, sfKey, cornerKeys, seatedRoles } = opts;
  const at = opts.at ?? new Date().toISOString();
  const wrote = named.verdict === "ok";

  const byLap = new Map<string, SectorCrossing[]>();
  for (const c of sectors.crossings) {
    const key = `${c.key}:${c.lapNumber}`;
    const list = byLap.get(key) ?? [];
    list.push(c);
    byLap.set(key, list);
  }

  // Marks: decisions. Seated drivers, crossings the pass is sure of, and the start line itself —
  // which is a transponder-vouched moment and the one thing here that is never in doubt.
  const marks: ManualFrameMark[] = [];
  if (wrote) {
    for (const c of sectors.crossings) {
      if (!c.role || !seatedRoles.has(c.role) || c.unsure) continue;
      marks.push({
        sessionId: opts.sessionId,
        driverRole: c.role,
        lapNumber: c.lapNumber,
        lineKey: c.lineKey,
        videoTimeSec: c.t,
        source: c.source,
        dir: c.dir,
        ...(c.others.length ? { candidates: toCandidates(c.others) } : {}),
      });
    }
  }

  // Rows: the evidence, in the shape `lastScan` already uses, so one reader serves both passes.
  const rows: ManualScanRow[] = [];
  for (const c of sectors.crossings) {
    if (!c.role) continue;
    rows.push({
      driverRole: c.role,
      lapNumber: c.lapNumber,
      lineKey: c.lineKey,
      videoTimeSec: c.t,
      source: c.source,
      // An unsure cell, or one a long way from where this driver usually crosses, is held back
      // and shown rather than written — the same meaning "suspect" already carries.
      suspect: c.unsure || c.surprise,
      candidates: toCandidates(c.others),
    });
  }
  for (const m of sectors.missing) {
    if (!m.role) continue;
    rows.push({
      driverRole: m.role,
      lapNumber: m.lapNumber,
      lineKey: m.lineKey,
      videoTimeSec: null,
      source: null,
      suspect: false,
      candidates: [],
    });
  }

  // Traces: the picture, for seated drivers' laps that kept a path of their own.
  let traces: Record<string, ManualLapTrace> = {};
  if (wrote) {
    for (const lap of named.laps) {
      if (!lap.role || !seatedRoles.has(lap.role) || !lap.pathComplete) continue;
      const step = frameStep(lap.points);
      const span = lap.endSec - lap.startSec;
      const expected = Math.max(1, Math.round(span / step));
      const coverage = Math.min(1, lap.points.length / expected);
      const segments = segmentsOf(lap, byLap.get(`${lap.key}:${lap.lapNumber}`) ?? [], sfKey, cornerKeys, step);
      traces[traceKey(lap.role, lap.lapNumber)] = {
        version: LAP_TRACE_VERSION,
        at,
        sessionId: opts.sessionId,
        driverRole: lap.role,
        lapNumber: lap.lapNumber,
        frame: { w: frameW, h: frameH },
        startSec: lap.startSec,
        endSec: lap.endSec,
        points: tracePoints(lap.points, frameW, frameH),
        holes: holesOf(lap.points, HOLE_SEC),
        segments,
        quality: {
          coverage,
          anchorsHit: segments.filter((s) => s.pinned?.from && s.pinned?.to).length,
          anchorsTotal: segments.length,
          ambiguousFrames: 0,
          ok: coverage >= OK_COVERAGE && lap.sfMatched,
        },
        recipe: RACE_RECIPE,
      };
    }
    traces = thinToFit(traces);
  }

  const measuredLapStarts: Array<{ role: DriverRole; lapNumber: number; videoTimeSec: number }> = [];
  if (wrote) {
    const seen = new Set<string>();
    for (const lap of named.laps) {
      if (!lap.role || !seatedRoles.has(lap.role)) continue;
      for (const [lapNumber, videoTimeSec] of [
        [lap.lapNumber, lap.startSec],
        [lap.lapNumber + 1, lap.endSec],
      ] as const) {
        const key = `${lap.role}:${lapNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        measuredLapStarts.push({ role: lap.role, lapNumber, videoTimeSec });
      }
    }
  }

  const drivers = new Map<string, RaceRecordDriver>();
  for (const lap of named.laps) {
    const d = drivers.get(lap.key) ?? {
      key: lap.key,
      name: lap.name,
      ...(lap.role ? { role: lap.role } : {}),
      laps: [],
    };
    const step = lap.points.length > 1 ? frameStep(lap.points) : 1 / 30;
    const expected = Math.max(1, Math.round((lap.endSec - lap.startSec) / step));
    d.laps.push({
      lapNumber: lap.lapNumber,
      coverage: Math.min(1, lap.points.length / expected),
      sfMatched: lap.sfMatched,
      pathComplete: lap.pathComplete,
    });
    drivers.set(lap.key, d);
  }

  return {
    marks,
    rows,
    traces,
    measuredLapStarts,
    record: {
      at,
      sessionId: opts.sessionId,
      recipe: RACE_RECIPE,
      spanFromSec: opts.span.fromSec,
      spanToSec: opts.span.toSec,
      frames: opts.frames,
      readMs: opts.readMs,
      scale: opts.scale,
      drivers: [...drivers.values()],
      unnamed: named.unnamed,
      standing: linked.standing,
      merges: linked.merges,
      bridged: named.bridged,
      ties: named.ties.length,
      shakeFrames: opts.shakeFrames,
      namedShare: named.namedShare,
      sheetCheck: named.sheetCheck,
      verdict: named.verdict,
    },
  };
}

/**
 * Keep the paths under the size the session can carry, by taking every second point.
 *
 * Halved and halved again if need be. The first and last points always survive, because they are
 * the ends the crossings pinned.
 */
export function thinToFit(traces: Record<string, ManualLapTrace>, max = MAX_TRACES_BYTES): Record<string, ManualLapTrace> {
  let out = traces;
  for (let pass = 0; pass < 4; pass++) {
    const size = JSON.stringify(out).length;
    if (size <= max) return out;
    const next: Record<string, ManualLapTrace> = {};
    for (const [key, trace] of Object.entries(out)) {
      const points = trace.points.filter((_, i) => i % 2 === 0 || i === trace.points.length - 1);
      next[key] = { ...trace, points };
    }
    out = next;
  }
  return out;
}
