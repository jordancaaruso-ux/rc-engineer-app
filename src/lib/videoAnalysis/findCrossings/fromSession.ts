/**
 * The join between a marking session and the detector: what to look for, and what to keep.
 *
 * Everything the detector needs is already in the session. The sync anchor puts every lap on the
 * video clock, and the offsets — how long after a lap start the driver reaches each corner — come
 * either from a lap already marked by hand or from the bootstrap in `bootstrap.ts`, which works
 * them out from the footage.
 *
 * Start/finish is searched for but never written as a mark. Its time is a transponder fact, so
 * detecting it costs one short window and buys three things at once: proof the scan is aligned
 * (the gaps between detected start/finish crossings must reproduce the official lap times), a
 * fixed anchor for the second pass, and — because we know it is the right car — a sample of what
 * colour that car is.
 */

import type { Rgb } from "./carColour";
import {
  applyFieldAssignment,
  assignToField,
  type Claim,
  type FieldDriver,
  type FieldOutcome,
} from "./field";
import {
  dropDuplicates,
  flagImplausible,
  vouchedUnconfirmed,
  flagOutOfOrder,
  type RefinableResult,
  type RefineOutcome,
  dropCrossDriverDuplicates,
} from "./refine";
import { refineByLapFit } from "./lapFit";
import type { CrossingEvent, CrossingTarget } from "./types";
import {
  applyLineDirections,
  directionsFromMarks,
  lineDirections,
  pickedCandidate,
  withDirection,
  type LineDir,
} from "./direction";
import {
  clockDisagreements,
  correctedLapStarts,
  lapDrift,
  type ClockDisagreement,
} from "./lapClock";

/**
 * Whose crossing this is. Mirrors `DriverRole` in the manual-analysis model, spelled out again
 * rather than imported because this folder is deliberately free of app imports — the replay
 * scripts run it under bare tsx.
 *
 * More than two because practice footage can hold more than two people: one LiveRC practice link
 * is one driver, so several drivers means several links, and each takes a seat here. The role is
 * the whole of a target's identity (`role:lap:line`), so no two drivers may share one.
 */
export type SessionRole = "me" | "competitor" | `r${number}`;

/** One line the driver has drawn, in the shape the detector wants. */
export type SessionLine = {
  lineKey: string;
  label: string;
  sortOrder: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type SessionMark = {
  driverRole: SessionRole;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number;
  /** Which way the car crossed, when a scan chose this time. Absent on a hand mark. */
  dir?: LineDir;
};

/** One crossing the detector should look for, tagged with whose lap it is. */
export type SessionTarget = CrossingTarget & { role: SessionRole };

/** Video time at which a given driver's lap starts, or null when it cannot be known. */
export type LapStartFn = (role: SessionRole, lapNumber: number) => number | null;

export const SF_LINE_KEY = "sf";

/** Ignore predictions this close to either end of the file — the window would be clipped. */
const EDGE_SEC = 2;

/** Base half-window, before any widening for a slow lap. */
export const BASE_WINDOW_SEC = 2.0;
/** Ceiling on that widening, so one disastrous lap cannot turn into a whole-session scan. */
const MAX_WINDOW_SEC = 8.0;
/**
 * Half-window for a start/finish crossing: the transponder already says when, to the frame.
 *
 * Half a second, not the 0.8 it was: on race footage a rival a second and a half behind kept
 * turning up inside that window, and was taken as the driver.
 */
export const SF_WINDOW_SEC = 0.5;
/**
 * How far a detected start/finish crossing may sit from the transponder's walk and still be
 * believed.
 *
 * Once the anchor is right the walk is exact to a frame on every lap — measured at 5–11ms on the
 * first race footage, for both cars. A crossing further off than this is not a better answer
 * than the walk, it is a different car: at Boronia the window caught whoever crossed behind, that
 * car's colour was learnt as "yours", and one whole lap was then read as somebody else's. So the
 * walk wins, and a detection only ever confirms it.
 */
export const SF_AGREE_SEC = 0.25;

/** The lap start to chain from: the detection when it agrees with the timing, the timing otherwise. */
export function sfAnchorTime(detectedSec: number | undefined, walkSec: number): number {
  if (detectedSec == null) return walkSec;
  return Math.abs(detectedSec - walkSec) <= SF_AGREE_SEC ? detectedSec : walkSec;
}

/**
 * The lap start to use when the walk has been drift-corrected: the detection when it agrees
 * with EITHER the corrected start or the plain walk, the corrected start otherwise.
 *
 * The walk is exact at the anchor lap and only ever drifts slowly, so a detection sitting on it
 * is a measurement whatever the drift model says. The model reads a lap whose every line came
 * late as a clock error — which is also what a slow first sector on a warm-up lap looks like: on
 * Bendigo lap 1 (2026-09-02) it moved the start by +0.39s and then threw away a start line seen
 * within 20ms of the transponder for disagreeing with the very number it had just invented.
 */
function sfStartFor(detectedSec: number | undefined, correctedSec: number, walkSec: number): number {
  if (detectedSec == null) return correctedSec;
  if (Math.abs(detectedSec - correctedSec) <= SF_AGREE_SEC) return detectedSec;
  if (Math.abs(detectedSec - walkSec) <= SF_AGREE_SEC) return detectedSec;
  return correctedSec;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function targetId(role: SessionRole, lapNumber: number, lineKey: string): string {
  return `${role}:${lapNumber}:${lineKey}`;
}

/** Group key for the second pass: one driver's lap, never two drivers' laps mixed. */
export function lapKeyOf(r: { id: string }): string {
  const [role, lap] = r.id.split(":");
  return `${role}:${lap}`;
}

/**
 * How far either side of the prediction to read, for a lap of this length.
 *
 * A clean lap needs two seconds. A lap where the driver went off and lost six is six seconds out
 * of position from the mistake onwards — and the timing sheet already knows which laps those are,
 * because they took longer. So the window is widened by exactly the time that lap lost. It costs
 * nothing on a normal lap and is the difference between finding and missing on a bad one.
 */
export function windowForLap(lapTimeSec: number, medianLapTimeSec: number): number {
  const lost = Math.max(0, lapTimeSec - medianLapTimeSec);
  return Math.min(MAX_WINDOW_SEC, BASE_WINDOW_SEC + lost);
}

export type LapInput = { role: SessionRole; lapNumber: number; lapTimeSec: number };

/**
 * The fastest N laps a driver did.
 *
 * Not "the laps you ticked": the aggregations this feeds — a driver's typical time through each
 * corner, and how that compares with a rival — want a real sample, and ten good laps is one. It
 * also makes working out which car is yours far more certain, because the more laps a candidate
 * has to stay in step across, the less chance it is somebody else.
 */
export function fastestLaps(
  laps: Array<{ lapNumber: number; lapTimeSec: number; isIncluded?: boolean }>,
  count: number
): number[] {
  const real = realLaps(laps);
  return real
    .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
    .slice(0, count)
    .map((l) => l.lapNumber)
    .sort((a, b) => a - b);
}

/**
 * The shortest time that can be a whole lap, as a fraction of this driver's median.
 *
 * In a race the first lap is timed from the start line rather than from start/finish, so it is a
 * fragment — 0.9s against a 17s median in the session that found this. Sorting by lap time then
 * puts the fragment FIRST, so "the fastest ten laps" spent its best slot on a lap that never
 * existed, and both drivers' fragments landed on the same piece of video. No driver is ever 40%
 * quicker than their own median, so nothing real is lost here.
 */
const SHORTEST_REAL_LAP_FRACTION = 0.6;

export function realLaps<T extends { lapTimeSec: number; isIncluded?: boolean }>(laps: T[]): T[] {
  const usable = laps.filter((l) => l.isIncluded !== false && l.lapTimeSec > 0);
  if (usable.length < 3) return usable;
  const sorted = [...usable].map((l) => l.lapTimeSec).sort((a, b) => a - b);
  const mid = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return usable.filter((l) => l.lapTimeSec >= mid * SHORTEST_REAL_LAP_FRACTION);
}

/**
 * How long after a lap start this driver reaches each line, from marks already made.
 *
 * Median rather than mean: one mis-tapped mark should not drag the whole prediction, and on a
 * single marked lap the two are the same anyway.
 */
export function seedOffsetsFromMarks(
  marks: SessionMark[],
  lapStart: LapStartFn
): Record<string, number> {
  const byLine = new Map<string, number[]>();
  for (const m of marks) {
    if (m.lineKey === SF_LINE_KEY) continue;
    const start = lapStart(m.driverRole, m.lapNumber);
    if (start == null) continue;
    const list = byLine.get(m.lineKey) ?? [];
    list.push(m.videoTimeSec - start);
    byLine.set(m.lineKey, list);
  }
  const out: Record<string, number> = {};
  for (const [key, list] of byLine) out[key] = median(list);
  return out;
}

export type BuiltTargets = {
  targets: SessionTarget[];
  /** Lap starts the detector will chain from, keyed the same way as targets. */
  lapStarts: Array<{ role: SessionRole; lapNumber: number; videoTimeSec: number }>;
  /** Lines with no offset to search around — nothing can be predicted for these. */
  unseededLines: string[];
  /** Targets skipped because they already have a hand mark. */
  alreadyMarked: number;
};

/**
 * Build the search list: every chosen lap × every line, minus what is already marked.
 *
 * Seeds are pooled across both drivers by default. The offset from a lap start to a corner is a
 * property of the track and the racing line, not of the driver — close enough between two drivers
 * that one driver's offsets aim the other's search well within its window.
 *
 * `seedsByRole` overrides that for a driver who has been identified by eye. Pooling is a fair
 * approximation; a driver who has actually watched a car go past is not approximating, and their
 * answer must not be overwritten by the other driver's.
 */
export function buildTargets(opts: {
  lines: SessionLine[];
  laps: LapInput[];
  marks: SessionMark[];
  lapStart: LapStartFn;
  durationSec: number;
  /** Offsets from lap start to each line. Omit to learn them from the marks. */
  seeds?: Record<string, number>;
  /** Per-driver offsets, where they are known better than the shared ones. */
  seedsByRole?: Partial<Record<SessionRole, Record<string, number>>>;
  /** Skip targets that already carry a hand mark. Default true — never re-do the driver's work. */
  skipMarked?: boolean;
  /** Include a short window on the start/finish line per lap. Default true. */
  includeSf?: boolean;
}): BuiltTargets {
  const {
    lines,
    laps,
    marks,
    lapStart,
    durationSec,
    skipMarked = true,
    includeSf = true,
  } = opts;
  const corners = lines
    .filter((l) => l.lineKey !== SF_LINE_KEY)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const seeds = opts.seeds ?? seedOffsetsFromMarks(marks, lapStart);
  const marked = new Set(marks.map((m) => targetId(m.driverRole, m.lapNumber, m.lineKey)));
  const medianLap = laps.length ? median(laps.map((l) => l.lapTimeSec)) : 0;

  const targets: SessionTarget[] = [];
  const lapStarts: BuiltTargets["lapStarts"] = [];
  let alreadyMarked = 0;

  const push = (
    role: SessionRole,
    lapNumber: number,
    lineKey: string,
    centerSec: number,
    half: number
  ) => {
    if (centerSec < EDGE_SEC || centerSec > durationSec - EDGE_SEC) return;
    targets.push({
      id: targetId(role, lapNumber, lineKey),
      role,
      lineKey,
      lapNumber,
      centerSec,
      truthSec: null,
      searchFrom: Math.max(0, centerSec - half),
      searchTo: Math.min(durationSec, centerSec + half),
    });
  };

  for (const lap of laps) {
    const start = lapStart(lap.role, lap.lapNumber);
    if (start == null) continue;
    lapStarts.push({ role: lap.role, lapNumber: lap.lapNumber, videoTimeSec: start });
    const half = windowForLap(lap.lapTimeSec, medianLap);

    if (includeSf) push(lap.role, lap.lapNumber, SF_LINE_KEY, start, SF_WINDOW_SEC);

    for (const line of corners) {
      const offset = opts.seedsByRole?.[lap.role]?.[line.lineKey] ?? seeds[line.lineKey];
      if (offset == null) continue;
      const id = targetId(lap.role, lap.lapNumber, line.lineKey);
      if (skipMarked && marked.has(id)) {
        alreadyMarked++;
        continue;
      }
      push(lap.role, lap.lapNumber, line.lineKey, start + offset, half);
    }
  }

  return {
    targets,
    lapStarts,
    unseededLines: corners.filter((l) => seeds[l.lineKey] == null).map((l) => l.lineKey),
    alreadyMarked,
  };
}

/**
 * Second-pass targets for the crossings the first pass missed: the stretch between the corners
 * either side of them.
 *
 * This is the one search that cannot be out of range. Whatever happened on that lap — a crash, a
 * spin, a lap spent waiting for a marshal — if the corner before it and the corner after it were
 * both found, the missing one happened in between. So read all of it.
 *
 * The guess inside that stretch is proportional rather than fixed: if this corner usually sits
 * four tenths of the way from the one before to the one after, look four tenths of the way along.
 * That stays right on a lap that took twice as long, where a fixed offset would not.
 */
export function bracketTargets(opts: {
  missing: SessionTarget[];
  /** Everything known so far — detections, hand marks, and lap starts. */
  known: Array<{ role: SessionRole; lapNumber: number; lineKey: string; videoTimeSec: number }>;
  /** Track order, first to last, including the start/finish key. */
  order: string[];
  /** Typical offset from lap start to each line, for the proportional guess. */
  seeds: Record<string, number>;
  durationSec: number;
}): SessionTarget[] {
  const { missing, known, order, seeds, durationSec } = opts;
  const at = new Map(known.map((k) => [targetId(k.role, k.lapNumber, k.lineKey), k.videoTimeSec]));
  const rank = new Map(order.map((k, i) => [k, i]));

  const out: SessionTarget[] = [];
  for (const m of missing) {
    const mine = rank.get(m.lineKey);
    if (mine == null) continue;

    // Nearest known crossing before and after, in TRACK order, on this driver's lap.
    let before: { key: string; t: number } | null = null;
    let after: { key: string; t: number } | null = null;
    for (const key of order) {
      const r = rank.get(key)!;
      const t = at.get(targetId(m.role, m.lapNumber, key));
      if (t == null) continue;
      if (r < mine && (!before || r > rank.get(before.key)!)) before = { key, t };
      if (r > mine && (!after || r < rank.get(after.key)!)) after = { key, t };
    }
    // The next lap's start closes the bracket when this is the last corner before it.
    if (!after) {
      const nextStart = at.get(targetId(m.role, m.lapNumber + 1, SF_LINE_KEY));
      if (nextStart != null) after = { key: SF_LINE_KEY, t: nextStart };
    }
    if (!before || !after || after.t <= before.t) continue;

    const oBefore = before.key === SF_LINE_KEY ? 0 : (seeds[before.key] ?? 0);
    const oAfter = after.key === SF_LINE_KEY ? oBefore + 1 : (seeds[after.key] ?? oBefore + 1);
    const oMine = seeds[m.lineKey] ?? (oBefore + oAfter) / 2;
    const frac = oAfter > oBefore ? (oMine - oBefore) / (oAfter - oBefore) : 0.5;
    const centerSec = before.t + Math.min(0.95, Math.max(0.05, frac)) * (after.t - before.t);

    out.push({
      ...m,
      centerSec,
      searchFrom: Math.max(0, before.t + 0.05),
      searchTo: Math.min(durationSec, after.t - 0.05),
    });
  }
  return out;
}

export type ReviewedCrossing = {
  id: string;
  role: SessionRole;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number;
  source: "confirmed" | "rescued" | "unconfirmed" | null;
  /** True when this time is a poor fit for the line's own sector times across the other laps. */
  suspect: boolean;
  /** Set when the field's timing says this crossing was somebody else's car (or another lap). */
  claimedBy?: Claim;
  colour?: Rgb;
  /** Which way the car crossed — the line's direction, held to across every lap and driver. */
  dir?: LineDir;
  /** Everything the window saw, so the decision can be re-run later without a re-scan. */
  candidates: CrossingEvent[];
};

/** One line's direction, and what holding the rows to it did — see `direction.ts`. */
export type LineDirection = {
  lineKey: string;
  dir: LineDir;
  /** Who settled it: a tap at the picker, an earlier scan's marks, or the majority of picks. */
  from: "picker" | "marks" | "majority";
  /** Rows whose pick went the other way and took the nearest right-way candidate instead. */
  turned: number;
  /** Rows whose pick went the other way with nothing right-way on offer — sent back as gaps. */
  emptied: number;
};

export type Review = {
  found: ReviewedCrossing[];
  /** Found, but a poor fit — held back from the marks unless the driver asks for them. */
  suspect: ReviewedCrossing[];
  /** Targets with no crossing at all. Left as gaps; never filled with a guess. */
  missing: SessionTarget[];
  /** What every window saw, keyed by target id — including the windows that found nothing. */
  candidatesById: Record<string, CrossingEvent[]>;
  /** Lines where a driver's colour proved able to tell the cars apart and helped decide. */
  colourLines: Array<{ lineKey: string; roles: SessionRole[] }>;
  /** Track order learnt from the detections, first line to last. */
  order: string[];
  /** The direction each line was held to, and how many rows that turned or emptied. */
  directions: LineDirection[];
  /**
   * Start/finish crossings, which are never marks. The gaps between them must reproduce the
   * official lap times — the free accuracy check on the whole scan.
   */
  lapStartError: { laps: number; medianMs: number; worstMs: number } | null;
  /**
   * Where each lap actually starts on the video clock: the detected start/finish when there was
   * one, otherwise the transponder's walk moved by the drift that lap's own crossings show.
   *
   * Written back as `perLapSfStart` / `perLapSfEnd`, which is what makes sector 1 a measurement
   * rather than a subtraction against an accumulating clock — see `lapClock.ts`.
   */
  measuredLapStarts: Array<{
    role: SessionRole;
    lapNumber: number;
    videoTimeSec: number;
    /** True when a detected crossing set it, false when it is the corrected walk. */
    detected: boolean;
    /** How far this lap's start moved from the transponder's walk. */
    driftSec: number;
  }>;
  /** Laps where the footage and the timing sheet disagree about how long the lap took. */
  clockDisagreements: ClockDisagreement[];
};

/**
 * Turn raw detections into something safe to write: chain each lap, then hold back anything that
 * does not fit the rest of the session.
 *
 * The hand marks and the known lap starts both go in as fixed points the chain can use but never
 * move, so the driver's own work anchors the automatic work rather than competing with it.
 */
export function reviewResults(opts: {
  results: Array<RefinableResult & { colour?: Rgb }>;
  targets: SessionTarget[];
  marks: SessionMark[];
  lapStarts: BuiltTargets["lapStarts"];
  /** Official lap times, for the start/finish accuracy check. */
  laps?: LapInput[];
  /**
   * Everyone in the race with their lap starts on the video clock. With this, each crossing is
   * given to whoever in the field was due there — see `field.ts` — rather than to this driver
   * because it was nearest to where they were expected.
   */
  field?: FieldDriver[];
  /**
   * Which way through a line is the corner, where somebody already said: the driver at the
   * picker, or the marks an earlier scan wrote. Lines not listed go by majority — `direction.ts`.
   */
  lineDirections?: Partial<Record<string, LineDir>>;
}): Review {
  const { results: scanned, targets, marks, lapStarts, laps = [], field } = opts;
  const lapTimeByKey = new Map(laps.map((l) => [`${l.role}:${l.lapNumber}`, l.lapTimeSec]));

  // **One way through each line, before anything else judges a row.** A line at a hairpin is
  // crossed twice a lap in opposite directions and a window takes whichever pass sits nearer its
  // guess. The chain, the field matching and the odd-lap vote all take the picks as given, so the
  // wrong leg has to be turned before they run, and the wrong-way candidates taken out of their
  // reach. The full list every window saw is kept as the evidence on each row.
  // The start line is left out: it answers to the transponder (`sfAnchorTime`), which is a far
  // stronger check than a majority, and a big car passing a long near line throws several flips
  // both ways within a few tenths — turning one of those to "the other way" moved a measured lap
  // start off by four tenths on the first try.
  const declared = new Map<string, LineDir>();
  for (const [line, d] of Object.entries(opts.lineDirections ?? {})) if (d) declared.set(line, d);
  const fromMarks = directionsFromMarks(marks);
  const known = new Map<string, LineDir>([...fromMarks, ...declared]);
  known.delete(SF_LINE_KEY);
  const dirs = lineDirections(
    scanned.filter((r) => r.lineKey !== SF_LINE_KEY),
    known
  );
  const oriented = applyLineDirections(scanned, dirs);
  const results = oriented.rows.map((r) => withDirection(r, dirs.get(r.lineKey)));
  const evidence = new Map(scanned.map((r) => [r.id, r.candidates]));
  const onLine = (ids: string[], lineKey: string) => ids.filter((id) => id.endsWith(`:${lineKey}`)).length;
  const directions: LineDirection[] = [...dirs].map(([lineKey, dir]) => ({
    lineKey,
    dir,
    from: declared.has(lineKey) ? "picker" : fromMarks.has(lineKey) ? "marks" : "majority",
    turned: onLine(oriented.turned, lineKey),
    emptied: onLine(oriented.emptied, lineKey),
  }));

  const fixed = (id: string, lineKey: string, lapNumber: number, t: number): RefinableResult => ({
    id,
    lineKey,
    lapNumber,
    centerSec: t,
    detectedSec: t,
    quality: null,
    candidates: [],
    source: "confirmed",
  });

  const byId = new Map(targets.map((t) => [t.id, t]));
  const detectedSf = new Map<string, number>();
  for (const r of results) {
    if (r.lineKey === SF_LINE_KEY && r.detectedSec != null) detectedSf.set(r.id, r.detectedSec);
  }

  // **The walked lap starts, moved by the drift each lap's own crossings show.**
  //
  // The walk is one anchor plus every lap time added up, so a single wrong lap time is carried
  // for the rest of the session: at Bendigo (2026-09-01) the sheet's lap 8 was half a second
  // longer than the footage, and every lap after it sat that much out. A detected start/finish
  // was then measured against the drifted walk, disagreed by more than `SF_AGREE_SEC`, and was
  // thrown away in favour of the very thing that was wrong. So the drift is taken off first, and
  // a detection is judged against where the lap actually is.
  const walked = new Map(lapStarts.map((l) => [`${l.role}:${l.lapNumber}`, l.videoTimeSec]));
  const drift = lapDrift(results, walked, SF_LINE_KEY, lapKeyOf);
  const corrected = correctedLapStarts(walked, drift);

  const anchors: RefinableResult[] = [
    ...lapStarts.map((l) => {
      const id = targetId(l.role, l.lapNumber, SF_LINE_KEY);
      const start = corrected.get(`${l.role}:${l.lapNumber}`) ?? l.videoTimeSec;
      return fixed(id, SF_LINE_KEY, l.lapNumber, sfStartFor(detectedSf.get(id), start, l.videoTimeSec));
    }),
    ...marks
      .filter((m) => m.lineKey !== SF_LINE_KEY)
      .map((m) =>
        fixed(targetId(m.driverRole, m.lapNumber, m.lineKey), m.lineKey, m.lapNumber, m.videoTimeSec)
      ),
  ];
  const anchorIds = new Set(anchors.map((a) => a.id));

  const all = [...anchors, ...results.filter((r) => !anchorIds.has(r.id))];
  // Each lap fitted whole against the driver's own rhythm — `lapFit.ts`. It sees every candidate
  // a window offered, wrong-way ones included at a price, where the rows below carry only the
  // right-way ones: direction is a penalty here and a filter for the field and the vote.
  const chainedOnly = refineByLapFit(all, SF_LINE_KEY, lapKeyOf, {
    dirs,
    candidatesOf: (r) => evidence.get(r.id) ?? r.candidates,
    fixed: anchorIds,
  });

  // The field's turn: every candidate on a line, matched to whoever was due there. A time the
  // field gives to a rival is swapped for the candidate that fits this driver's own slot, or —
  // when nothing does — kept but labelled, so it is held back and shown rather than written.
  const assignment =
    field && field.length
      ? assignToField({ results: chainedOnly, field, sfKey: SF_LINE_KEY })
      : null;
  const chained: Array<FieldOutcome<RefineOutcome<RefinableResult>>> = assignment
    ? applyFieldAssignment(chainedOnly, assignment, anchorIds)
    : chainedOnly;

  // Two laps sharing a crossing, and a lap visiting its corners out of order, are both provably
  // wrong from the numbers alone — no reference data, no watching. They are settled before
  // plausibility, so a duplicate can never sit in the sample that decides what "usual" looks like.
  const duplicateIds = dropDuplicates(
    chained,
    (r) => `${roleOf(r.id)}:${r.lineKey}`,
    minCrossingGapSec(laps)
  );
  // One event handed to two drivers is one car: the other driver's copy goes before the vote,
  // or four stolen times outvote two real ones and a whole line is held (Bendigo S1, 2026-09-01).
  for (const id of dropCrossDriverDuplicates(chained, (r) => roleOf(r.id), anchorIds)) {
    duplicateIds.add(id);
  }
  const liveResults = chained.filter((r) => !duplicateIds.has(r.id));
  const outOfOrderIds = flagOutOfOrder(liveResults, SF_LINE_KEY, lapKeyOf);
  const suspectIds = flagImplausible(liveResults, SF_LINE_KEY, lapKeyOf);
  const vouchedIds = vouchedUnconfirmed(liveResults, SF_LINE_KEY, lapKeyOf, suspectIds);

  const found: ReviewedCrossing[] = [];
  const suspect: ReviewedCrossing[] = [];
  const missing: SessionTarget[] = [];
  const colourById = new Map(results.map((r) => [r.id, r.colour]));

  for (const r of chained) {
    const target = byId.get(r.id);
    if (!target || target.lineKey === SF_LINE_KEY) continue;
    // A duplicate is not a weak answer, it is somebody else's answer — it leaves a gap, not a flag.
    if (r.detectedSec == null || duplicateIds.has(r.id)) {
      missing.push(target);
      continue;
    }
    // An untracked flicker is held back unless the timing vouches for it. It passed no "moves
    // like a car" test — it is a frame-pair sign flip and nothing more — and writing it as a mark
    // is how shaken paint became a sector time on three lines of a whole race. But a flicker at
    // the moment this driver crosses this line on every other lap is the car, and it goes in
    // marked less certain. Everything else stays visible so a driver can look at it.
    const row: ReviewedCrossing = {
      id: r.id,
      role: target.role,
      lapNumber: target.lapNumber,
      lineKey: target.lineKey,
      videoTimeSec: r.detectedSec,
      source: r.source,
      suspect:
        suspectIds.has(r.id) ||
        outOfOrderIds.has(r.id) ||
        (r.source === "unconfirmed" && !vouchedIds.has(r.id)) ||
        r.claimedBy != null,
      claimedBy: r.claimedBy,
      colour: colourById.get(r.id),
      dir: dirs.get(target.lineKey) ?? pickedCandidate(r)?.dir,
      candidates: evidence.get(r.id) ?? r.candidates,
    };
    (row.suspect ? suspect : found).push(row);
  }

  const candidatesById: Record<string, CrossingEvent[]> = {};
  for (const r of scanned) candidatesById[r.id] = r.candidates;

  return {
    found,
    suspect,
    missing,
    candidatesById,
    colourLines: assignment
      ? [...assignment.colourLines].map(([lineKey, roles]) => ({ lineKey, roles }))
      : [],
    order: learntOrder(chained),
    directions,
    lapStartError: sfAccuracy(results, laps),
    measuredLapStarts: lapStarts.map((l) => {
      const key = `${l.role}:${l.lapNumber}`;
      const id = targetId(l.role, l.lapNumber, SF_LINE_KEY);
      const start = corrected.get(key) ?? l.videoTimeSec;
      const seen = detectedSf.get(id);
      const used = sfStartFor(seen, start, l.videoTimeSec);
      return {
        role: l.role,
        lapNumber: l.lapNumber,
        videoTimeSec: used,
        detected: seen != null && used === seen,
        driftSec: start - l.videoTimeSec,
      };
    }),
    clockDisagreements: clockDisagreements(
      chained,
      (key) => lapTimeByKey.get(key) ?? null,
      SF_LINE_KEY,
      lapKeyOf
    ),
  };
}

/** The driver a target id belongs to — ids are `role:lap:line` by construction. */
export function roleOf(id: string): SessionRole {
  return (id.split(":")[0] ?? "me") as SessionRole;
}

/**
 * How close two crossings of one line have to be before they must be the same event.
 *
 * A car crosses a given line once a lap, so anything under half a lap apart is one crossing
 * counted twice. Capped at a second because that is already far beyond any timing error, and an
 * over-wide window would start merging genuinely different laps when one of them is badly placed.
 */
const MAX_DUPLICATE_GAP_SEC = 1.0;

function minCrossingGapSec(laps: LapInput[]): number {
  const times = realLaps(laps).map((l) => l.lapTimeSec);
  if (times.length === 0) return MAX_DUPLICATE_GAP_SEC;
  return Math.min(MAX_DUPLICATE_GAP_SEC, Math.min(...times) * 0.5);
}

function learntOrder(chained: RefinableResult[]): string[] {
  const byLine = new Map<string, number[]>();
  const sfAt = new Map<string, number>();
  for (const r of chained) {
    if (r.lineKey === SF_LINE_KEY && r.detectedSec != null) sfAt.set(lapKeyOf(r), r.detectedSec);
  }
  for (const r of chained) {
    if (r.lineKey === SF_LINE_KEY || r.detectedSec == null) continue;
    const start = sfAt.get(lapKeyOf(r));
    if (start == null) continue;
    const list = byLine.get(r.lineKey) ?? [];
    list.push(r.detectedSec - start);
    byLine.set(r.lineKey, list);
  }
  return [
    SF_LINE_KEY,
    ...[...byLine].sort((a, b) => median(a[1]) - median(b[1])).map(([k]) => k),
  ];
}

/**
 * The free accuracy check: the gap between two detected start/finish crossings must be the lap
 * time the transponder recorded. Needs no reference data and no hand marks — if this is wrong,
 * everything else in the scan is wrong too, and the driver should be told before trusting any
 * of it.
 */
function sfAccuracy(
  results: Array<{ id: string; lineKey: string; detectedSec: number | null }>,
  laps: LapInput[]
): Review["lapStartError"] {
  const lapTime = new Map(laps.map((l) => [`${l.role}:${l.lapNumber}`, l.lapTimeSec]));
  const at = new Map<string, number>();
  for (const r of results) {
    if (r.lineKey === SF_LINE_KEY && r.detectedSec != null) at.set(lapKeyOf(r), r.detectedSec);
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
