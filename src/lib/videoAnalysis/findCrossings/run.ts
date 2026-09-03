"use client";

/**
 * The whole job, start to finish, so the screen only has to press the button.
 *
 * Two calls rather than one, because there is a point in the middle where the driver may have to
 * decide something and a promise that runs to completion cannot ask. `learnTheLap` reads the
 * footage and works out where the corners are; if it comes back sure, `findEveryCrossing` runs
 * straight away, and if it does not, the screen puts the choice to the driver first.
 *
 * The order of the passes is not arbitrary:
 *
 *  1. **Start/finish first.** Those times are transponder facts, so detecting them proves the
 *     whole scan is aligned before anything is inferred from it — and the thing that moved there
 *     is this driver's car by definition, which is where the reference colour comes from.
 *  2. **A few whole laps.** With nothing assumed, every line offers several crossings; the one
 *     that keeps repeating against this driver's own irregular lap times is theirs.
 *  3. **Narrow windows for the rest.** Now that the offsets are known, the remaining laps cost a
 *     couple of seconds of video each rather than a whole lap.
 *  4. **The gaps, bracketed.** Anything still missing is searched for between the corners either
 *     side of it — the one search that cannot be out of range.
 */

import {
  BOOTSTRAP_LAPS,
  bootstrapTargets,
  candidatesFrom,
  carColoursFromLapStarts,
  pruneImpossible,
  resolveOffsets,
  type BootstrapLap,
  type BootstrapResult,
} from "./bootstrap";
import { findCrossingsInBrowser, type ScanProgress } from "./browserScan";
import type { CarColour } from "./carColour";
import {
  bracketTargets,
  buildTargets,
  reviewResults,
  seedOffsetsFromMarks,
  SF_AGREE_SEC,
  SF_LINE_KEY,
  SF_WINDOW_SEC,
  targetId,
  type LapInput,
  type LapStartFn,
  type Review,
  type SessionLine,
  type SessionMark,
  type SessionRole,
} from "./fromSession";
import type { TrackedResult } from "./detector";
import type { LineCalibration } from "./calibrate";
import type { CarColours, FieldDriver } from "./field";

export type RunContext = {
  video: HTMLVideoElement;
  /** The picked file, when there is one: frames are decoded straight out of it. */
  file?: Blob | null;
  frameW: number;
  frameH: number;
  durationSec: number;
  lines: SessionLine[];
  laps: LapInput[];
  marks: SessionMark[];
  lapStart: LapStartFn;
  /** Everyone in the race with their lap starts, so a rival's crossing can be given to the rival. */
  field?: FieldDriver[];
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
};

export type LearnResult = BootstrapResult & {
  /** How each line was read, for the trust line. */
  calibrations: Record<string, LineCalibration>;
  /** Start/finish check: the gaps between detected lap starts against the official lap times. */
  lapStartError: { laps: number; medianMs: number; worstMs: number } | null;
  /** Where the offsets came from. */
  from: "marks" | "footage";
  /**
   * A reference colour per scanned driver, each learnt only where that car was alone and measured
   * against the other cars beside it. `car` is the older single reference (yours) kept for the
   * bootstrap; these are what the scan and the field matching use.
   */
  cars: CarColours;
  starvedSegments: number;
  /**
   * What the learning pass actually read. Zero laps and zero frames are completely different
   * faults from "read plenty and nothing repeated", and without these the screen cannot tell
   * them apart — which cost a full debugging cycle.
   */
  read: { laps: number; targets: number; frames: number };
};

function bootstrapLapsFor(laps: LapInput[], lapStart: LapStartFn): BootstrapLap[] {
  // The quickest laps, because a clean lap is where a corner sits at its typical offset. A lap
  // spent recovering from a mistake teaches the wrong number.
  return [...laps]
    .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
    .slice(0, BOOTSTRAP_LAPS)
    .map((l) => ({ ...l, startSec: lapStart(l.role, l.lapNumber) }))
    .filter((l): l is BootstrapLap => l.startSec != null);
}

function scaled(
  onProgress: RunContext["onProgress"],
  from: number,
  to: number,
  label: string
): (p: ScanProgress) => void {
  return (p) =>
    onProgress?.({ ...p, fraction: from + p.fraction * (to - from), note: `${label}${p.note}` });
}

/**
 * Work out how long after a lap start this driver reaches each corner.
 *
 * When the driver has already marked a lap, that IS the answer and no footage needs reading for
 * it. Otherwise it is measured — see `bootstrap.ts` for why irregular lap times give it away.
 */
export async function learnTheLap(ctx: RunContext): Promise<LearnResult> {
  const { video, frameW, frameH, durationSec, lines, laps, marks, lapStart, signal } = ctx;
  const cornerKeys = lines
    .filter((l) => l.lineKey !== SF_LINE_KEY)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => l.lineKey);

  const fromMarks = seedOffsetsFromMarks(marks, lapStart);
  const haveAll = cornerKeys.every((k) => fromMarks[k] != null);

  const bootLaps = bootstrapLapsFor(laps, lapStart);
  const sfTargets = bootLaps.map((l) => ({
    id: targetId(l.role, l.lapNumber, SF_LINE_KEY),
    role: l.role,
    lineKey: SF_LINE_KEY,
    lapNumber: l.lapNumber,
    centerSec: l.startSec,
    truthSec: l.startSec,
    searchFrom: Math.max(0, l.startSec - SF_WINDOW_SEC),
    searchTo: Math.min(durationSec, l.startSec + SF_WINDOW_SEC),
  }));

  // Start/finish always runs, marks or no marks: it is the alignment proof and the colour sample,
  // and it is only a second of video per lap.
  const sfScan = await findCrossingsInBrowser({
    video,
    file: ctx.file,
    frameW,
    frameH,
    lines,
    targets: sfTargets,
    onProgress: scaled(ctx.onProgress, 0, haveAll ? 0.9 : 0.25, "Checking the start line — "),
    signal,
  });
  // Only crossings that agree with the timing may teach the car's colour. The window still
  // admits a rival crossing just behind, and on race footage that rival's paint became "yours".
  const truthById = new Map(sfTargets.map((t) => [t.id, t.truthSec]));
  const cars = carColoursFromLapStarts(
    sfScan.results.filter(
      (r) =>
        r.detectedSec != null &&
        Math.abs(r.detectedSec - (truthById.get(r.id) ?? NaN)) <= SF_AGREE_SEC
    )
  );
  const car = cars.me ?? null;
  const lapStartError = sfCheck(sfScan.results, laps);

  if (haveAll) {
    return {
      seeds: fromMarks,
      verdicts: cornerKeys.map((k) => ({
        lineKey: k,
        offsetSec: fromMarks[k],
        laps: 0,
        colourDistance: null,
        rival: null,
      })),
      ambiguous: [],
      unresolved: [],
      diagnostics: [],
      car,
      cars,
      calibrations: sfScan.calibrations,
      lapStartError,
      from: "marks",
      starvedSegments: sfScan.starvedSegments,
      read: { laps: bootLaps.length, targets: sfTargets.length, frames: sfScan.framesRead },
    };
  }

  const bootTargets = bootstrapTargets(bootLaps, cornerKeys, durationSec);
  const scan = await findCrossingsInBrowser({
    video,
    file: ctx.file,
    frameW,
    frameH,
    lines,
    targets: bootTargets,
    car,
    onProgress: scaled(ctx.onProgress, 0.25, 1, "Learning the track — "),
    signal,
  });

  const medianLap = median(laps.map((l) => l.lapTimeSec));
  const resolved = pruneImpossible(
    resolveOffsets({
      laps: bootLaps,
      candidates: candidatesFrom(scan.results),
      car,
      cornerKeys,
    }),
    medianLap
  );

  return {
    ...resolved,
    cars,
    calibrations: { ...sfScan.calibrations, ...scan.calibrations },
    lapStartError,
    from: "footage",
    starvedSegments: sfScan.starvedSegments + scan.starvedSegments,
    read: { laps: bootLaps.length, targets: bootTargets.length, frames: scan.framesRead },
  };
}

/** How much video one sweep window covers. Short enough that the tracker's memory stays small. */
const SWEEP_CHUNK_SEC = 20;
/** Overlap between windows, so a car crossing on a seam is seen whole by one of them. */
const SWEEP_LAP_SEC = 0.6;
/** Two sightings this close are the same car going past once. */
const SWEEP_DEDUPE_SEC = 0.15;

export type SweepResult = {
  /** Every crossing of the start/finish line in the stretch, whoever it belonged to. */
  crossingsSec: number[];
  framesRead: number;
  starvedSegments: number;
  elapsedMs: number;
};

/**
 * Read the start/finish line right through a stretch of video and keep everything that crosses it.
 *
 * The rest of the scan looks in narrow windows, because it already knows when the car is due.
 * Somebody added from their own practice link is exactly the case where nothing is known — their
 * transponder clock and this video share no zero — so there is nothing to aim at and the line has
 * to be watched instead. What comes back is a list of moments, with no claim about whose car made
 * any of them: `fitLapsToCrossings` decides that from the lap times afterwards.
 *
 * Deliberately colour-blind. The detector's colour tiebreak exists to keep hold of ONE car, and
 * here every car is the point.
 */
export async function sweepStartFinish(
  ctx: RunContext,
  span: { fromSec: number; toSec: number }
): Promise<SweepResult> {
  const { video, frameW, frameH, durationSec, lines, signal } = ctx;
  const startedAt = performance.now();
  const from = Math.max(0, span.fromSec);
  const to = Math.min(durationSec, span.toSec);
  if (!(to > from)) {
    return { crossingsSec: [], framesRead: 0, starvedSegments: 0, elapsedMs: 0 };
  }

  const targets = [];
  for (let i = 0, at = from; at < to; i++, at += SWEEP_CHUNK_SEC) {
    const chunkTo = Math.min(to, at + SWEEP_CHUNK_SEC + SWEEP_LAP_SEC);
    targets.push({
      id: `sweep:${i}:${SF_LINE_KEY}`,
      role: "me" as SessionRole,
      lineKey: SF_LINE_KEY,
      lapNumber: i,
      centerSec: (at + chunkTo) / 2,
      // Nothing is expected here — that is the point of a sweep.
      truthSec: null,
      searchFrom: at,
      searchTo: chunkTo,
    });
  }

  const scan = await findCrossingsInBrowser({
    video,
    file: ctx.file,
    frameW,
    frameH,
    lines,
    targets,
    car: null,
    onProgress: scaled(ctx.onProgress, 0, 1, "Watching the start line — "),
    signal,
  });

  const seen = scan.results
    .flatMap((r) => r.candidates.map((c) => c.t))
    .sort((a, b) => a - b);
  const crossingsSec: number[] = [];
  for (const t of seen) {
    const last = crossingsSec[crossingsSec.length - 1];
    if (last == null || t - last > SWEEP_DEDUPE_SEC) crossingsSec.push(t);
  }

  return {
    crossingsSec,
    framesRead: scan.framesRead,
    starvedSegments: scan.starvedSegments,
    elapsedMs: performance.now() - startedAt,
  };
}

/**
 * Half-window either side of the clock's guess for a lap start. The timing page rounds its stamp
 * to a whole second and the phone's header to another, so the guess is good to about a second;
 * anything further off than this is a different car, and the fingerprint is what says so.
 */
export const CLOCK_CONFIRM_SEC = 1.5;
/** How many of a driver's opening laps are looked for on the start line to confirm the clock. */
export const CLOCK_CONFIRM_LAPS = 8;
/** Two sightings this close are the same car going past once. */
const CONFIRM_DEDUPE_SEC = 0.15;

export type LapStartScan = {
  /** Every crossing seen in the windows, whoever made it, in time order. */
  crossingsSec: number[];
  framesRead: number;
  starvedSegments: number;
  elapsedMs: number;
};

/**
 * Look at the start line where the wall clock says a driver's opening laps begin.
 *
 * The clock's guess is good to a second; this reads a short window around each of the first few
 * lap starts and hands back everything that crossed. Whether those crossings are this driver's
 * is the fingerprint's question (`fitLapsToCrossings`): their own lap times must land on them,
 * lap after lap, which a stranger's cannot. Eight windows of three seconds is a fraction of the
 * blind sweep, which read the start line right through the session to find the same thing.
 *
 * Colour-blind, like the sweep: nothing is known about the car yet.
 */
export async function scanLapStarts(
  ctx: RunContext,
  opts: { role: SessionRole; starts: Array<{ lapNumber: number; startSec: number }> }
): Promise<LapStartScan> {
  const { video, frameW, frameH, durationSec, lines, signal } = ctx;
  const startedAt = performance.now();
  const targets = opts.starts
    .filter((s) => s.startSec + CLOCK_CONFIRM_SEC > 0 && s.startSec - CLOCK_CONFIRM_SEC < durationSec)
    .map((s) => ({
      id: `clock:${opts.role}:${s.lapNumber}:${SF_LINE_KEY}`,
      role: opts.role,
      lineKey: SF_LINE_KEY,
      lapNumber: s.lapNumber,
      centerSec: s.startSec,
      // Not a truth: a guess to look around, and the fingerprint decides.
      truthSec: null,
      searchFrom: Math.max(0, s.startSec - CLOCK_CONFIRM_SEC),
      searchTo: Math.min(durationSec, s.startSec + CLOCK_CONFIRM_SEC),
    }));
  if (!targets.length) return { crossingsSec: [], framesRead: 0, starvedSegments: 0, elapsedMs: 0 };

  const scan = await findCrossingsInBrowser({
    video,
    file: ctx.file,
    frameW,
    frameH,
    lines,
    targets,
    car: null,
    onProgress: scaled(ctx.onProgress, 0, 1, "Checking the start line — "),
    signal,
  });

  const seen = scan.results
    .flatMap((r) => [...r.candidates.map((c) => c.t), ...(r.detectedSec != null ? [r.detectedSec] : [])])
    .sort((a, b) => a - b);
  const crossingsSec: number[] = [];
  for (const t of seen) {
    const last = crossingsSec[crossingsSec.length - 1];
    if (last == null || t - last > CONFIRM_DEDUPE_SEC) crossingsSec.push(t);
  }
  return {
    crossingsSec,
    framesRead: scan.framesRead,
    starvedSegments: scan.starvedSegments,
    elapsedMs: performance.now() - startedAt,
  };
}

export type FindResult = {
  review: Review;
  calibrations: Record<string, LineCalibration>;
  starvedSegments: number;
  /** How many gaps the bracketed second pass filled in. */
  bracketFilled: number;
  elapsedMs: number;
};

/** Find every crossing, given offsets that are already settled. */
export async function findEveryCrossing(
  ctx: RunContext,
  opts: {
    seeds: Record<string, number>;
    /** Offsets a driver settled by looking, which beat the shared ones for that driver. */
    seedsByRole?: Partial<Record<SessionRole, Record<string, number>>>;
    car: CarColour | null;
    /** Per-driver references; each target is judged against its own driver's. */
    cars?: CarColours;
    /** Which way through a line is the corner, where the driver said so at the picker. */
    lineDirections?: Partial<Record<string, 1 | -1>>;
  }
): Promise<FindResult> {
  const { video, frameW, frameH, durationSec, lines, laps, marks, lapStart, signal } = ctx;
  const startedAt = performance.now();

  const built = buildTargets({
    lines,
    laps,
    marks,
    lapStart,
    durationSec,
    seeds: opts.seeds,
    seedsByRole: opts.seedsByRole,
  });

  const main = await findCrossingsInBrowser({
    video,
    file: ctx.file,
    frameW,
    frameH,
    lines,
    targets: built.targets,
    car: opts.car,
    cars: opts.cars,
    onProgress: scaled(ctx.onProgress, 0, 0.85, ""),
    signal,
  });

  // Colour in the review is learnt per line, from what the timing pass hands each driver there —
  // see `field.ts`. The start-line reference (`opts.cars`) only serves the detector's own tiebreak.
  let review = reviewResults({
    results: main.results,
    targets: built.targets,
    marks,
    lapStarts: built.lapStarts,
    laps,
    field: ctx.field,
    lineDirections: opts.lineDirections,
  });

  // Second pass: whatever is still missing, searched for between the corners either side of it.
  let bracketFilled = 0;
  let results: TrackedResult[] = main.results;
  if (review.missing.length) {
    const known = [
      ...built.lapStarts.map((l) => ({ ...l, lineKey: SF_LINE_KEY })),
      ...marks.map((m) => ({
        role: m.driverRole,
        lapNumber: m.lapNumber,
        lineKey: m.lineKey,
        videoTimeSec: m.videoTimeSec,
      })),
      ...review.found.map((f) => ({
        role: f.role,
        lapNumber: f.lapNumber,
        lineKey: f.lineKey,
        videoTimeSec: f.videoTimeSec,
      })),
    ];
    const brackets = bracketTargets({
      missing: review.missing,
      known,
      order: review.order,
      seeds: opts.seeds,
      durationSec,
    });

    if (brackets.length) {
      const second = await findCrossingsInBrowser({
        video,
        file: ctx.file,
        frameW,
        frameH,
        lines,
        targets: brackets,
        car: opts.car,
        cars: opts.cars,
        onProgress: scaled(ctx.onProgress, 0.85, 1, "Filling the gaps — "),
        signal,
      });
      // The re-scan replaces the first pass's answer for those targets only.
      const redone = new Map(second.results.map((r) => [r.id, r]));
      results = main.results.map((r) => redone.get(r.id) ?? r);
      const before = review.missing.length;
      review = reviewResults({
        results,
        targets: built.targets,
        marks,
        lineDirections: opts.lineDirections,
        lapStarts: built.lapStarts,
        laps,
        field: ctx.field,
      });
      bracketFilled = before - review.missing.length;
    }
  }

  return {
    review,
    calibrations: main.calibrations,
    starvedSegments: main.starvedSegments,
    bracketFilled,
    elapsedMs: performance.now() - startedAt,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Gaps between detected lap starts against the official lap times. */
function sfCheck(
  results: Array<{ id: string; lineKey: string; detectedSec: number | null }>,
  laps: LapInput[]
): { laps: number; medianMs: number; worstMs: number } | null {
  const lapTime = new Map(laps.map((l) => [`${l.role}:${l.lapNumber}`, l.lapTimeSec]));
  const at = new Map<string, number>();
  for (const r of results) {
    if (r.lineKey !== SF_LINE_KEY || r.detectedSec == null) continue;
    const [role, lap] = r.id.split(":");
    at.set(`${role}:${lap}`, r.detectedSec);
  }
  const errs: number[] = [];
  for (const [key, t] of at) {
    const [role, lapStr] = key.split(":");
    const lap = Number(lapStr);
    const next = at.get(`${role}:${lap + 1}`);
    const expected = lapTime.get(`${role}:${lap}`);
    if (next == null || expected == null) continue;
    errs.push(Math.abs(next - t - expected) * 1000);
  }
  if (!errs.length) return null;
  return { laps: errs.length, medianMs: median(errs), worstMs: Math.max(...errs) };
}

export type { SessionRole };
