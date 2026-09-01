/**
 * "Which one is your car?" — settled by looking, not by arithmetic.
 *
 * The bootstrap works out which car is which from repetition: take the offset from a lap start
 * that keeps coming back against this driver's own irregular lap times, because a rival's laps are
 * a different length and drift out of step. On a practice session with one car on track that is
 * exact. In a race with a full field it is not: on the Boronia heat of 2026-08-26 the first three
 * lines came back following the wrong car, with errors of six hundred milliseconds to nearly two
 * seconds, and correlated within a lap — the signature of following something else, not of
 * imprecision.
 *
 * No amount of "2.84s into the lap, agreed on four laps" lets a driver settle that. A picture of
 * the moment does, instantly. So this reads the driver's most ordinary lap, keeps every car that
 * crossed each line rather than choosing between them, and hands them to the screen with the
 * position needed to cut a picture around each one.
 *
 * What comes back out is a seed offset per line — the same shape the bootstrap produces — so the
 * rest of the scan is unchanged. The driver has replaced a guess with a fact, nothing more.
 *
 * But "every car" was too many: six pictures a line, most of them cars the arithmetic could have
 * ruled out ("how would I ever be crossing S1 eleven seconds into the lap?" — the driver,
 * 2026-08-28). So each picture is checked against what is known before anybody taps, and the
 * ones that fail are folded away (never all of them, and always one tap to see):
 *
 *  - The start line on a few of their laps. The transponder says exactly when this car crossed
 *    it, so the colour of what moved there is this car's colour, learnt without anybody's tap
 *    ("different colour" under a picture that clearly is not it).
 *  - Two more of their laps, whole. Every car on the identify lap is then asked whose timing it
 *    moves with: a crossing that sits at the same offset from THIS driver's lap starts on the
 *    other laps is theirs; one that keeps step with a rival's lap starts instead is the rival's.
 *    On the Boronia heat of 2026-08-28 the driver tapped Sandy's car for Justin, and every mark
 *    written for Justin sat at a constant 0.02s against Sandy's laps while drifting 0.75s a lap
 *    against Justin's — the whole field's timing knew, and nothing asked it. Now the picker does.
 *  - Track order. The lines are numbered in the order the car meets them, a lap is only so
 *    long, and each corner comes at least a few tenths after the one before. A car at the last
 *    line three seconds into the lap cannot be this driver's.
 *  - The field. The same "whose timing does it move with" question, asked of every crossing in
 *    every window read, says how far into a lap each line comes for every driver followed. A
 *    crossing outside that stretch is nobody's corner ("how would I ever be crossing S1 eleven
 *    seconds into the lap? That seems like something you could determine for yourself" — the
 *    driver, 2026-08-28. It could, and now does).
 *  - The line itself. The detector's strip runs past each end of the drawn line, so on a fisheye
 *    a car on the neighbouring piece of track registers a "crossing". Beside the line is not
 *    across it — the line is where the driver said the corner is. When the car that kept step
 *    with them every lap is the one beside the line, the LINE is short, and the screen says so
 *    rather than hiding the right answer.
 *
 * None of it chooses. It tells the driver when a tap disagrees with the timing, which is the one
 * thing a thumbnail the size of a stamp cannot — and where one car kept step with them on every
 * lap read, it is picked for them to confirm.
 */

import { BOOTSTRAP_LAPS, carColoursFromLapStarts } from "./bootstrap";
import { findCrossingsInBrowser, type ScanProgress } from "./browserScan";
import {
  chromaDistance,
  chromaOf,
  colourUsable,
  rivalDistance,
  toleranceFor,
  type CarColour,
  type Rgb,
} from "./carColour";
import type { FieldDriver } from "./field";
import {
  SF_AGREE_SEC,
  SF_LINE_KEY,
  SF_WINDOW_SEC,
  targetId,
  type LapInput,
  type LapStartFn,
  type SessionLine,
  type SessionRole,
} from "./fromSession";
import { alongLine, lineGeom } from "./geometry";
import type { CrossingEvent, CrossingTarget } from "./types";

/** What the start-line colour says about one picture. Absent when it has no grounds to say. */
export type CarHint = "yours" | "other";

/** Whose timing a picture keeps step with, over the other laps read. */
export type MovesWith = {
  /** The driver's field key (the role for a scanned driver, the timing key otherwise). */
  key: string;
  name: string;
  /** True when that driver is the one being asked about. */
  mine: boolean;
  /** Other laps on which a crossing turned up where this driver's timing put it, out of those read. */
  hits: number;
  of: number;
};

/** One car crossing one line, on the lap being looked at. */
export type CarOption = {
  /** Video time of the crossing. */
  t: number;
  /** Seconds after the lap start — this is what becomes the seed if chosen. */
  offsetSec: number;
  /** Where it crossed, in frame pixels. Absent when the detector could not place it. */
  x?: number;
  y?: number;
  /** 0..10; how cleanly it passed rather than flickered. Ranks the list, never filters it. */
  quality: number;
  /** Mean colour of what moved, when the frame was read in colour. */
  colour?: Rgb;
  /** Against the colour learnt at the start line. Absent when nothing could be said. */
  hint?: CarHint;
  /** Whose laps this crossing repeats against. Absent when nothing repeats, or it is a tie. */
  movesWith?: MovesWith;
  /** Crossed past an end of the drawn line — the neighbouring track, not this corner. */
  offLine?: boolean;
  /** No way to reach this from the lap start and still visit the corners after it in order. */
  outOfOrder?: boolean;
  /** Outside the stretch of the lap in which the rest of the field crosses this line. */
  offField?: boolean;
  /** Which way it crossed — see CrossingEvent.dir. */
  dir?: 1 | -1;
  /**
   * Beside the line, kept step with this driver every lap, and NO car on the line did: the
   * line is short, not the car wrong. Shown, with the screen saying to lengthen the line.
   */
  shortLine?: boolean;
  /**
   * One of two passes of this driver's car through the same line a moment apart in opposite
   * directions — a hairpin, where only one pass is the corner they drew. Never picked for them.
   */
  hairpin?: boolean;
  /** Crossed the line the opposite way to the field — the return leg, not the corner. */
  wrongWay?: boolean;
  /**
   * Ruled out twice over (another driver's car AND outside the field's window, say). Not
   * shown at all, not even under "show more": "that should not be an option" — the driver,
   * 2026-08-28, of a car that moved with Sandy ten seconds into his lap. Kept on the record.
   */
  dropped?: boolean;
};

/** Why a picture is folded away, when it is. */
export type FoldReason = "other-car" | "colour" | "order" | "direction" | "field" | "off-line";

/**
 * How many of the other laps read a car must turn up on, where this driver's timing put it, to
 * count as theirs: all of them up to three, and three of four beyond that. With five laps read
 * (2026-08-28) "every lap" failed the driver's own car on a 41px line the detector missed once,
 * and the field learner emptied for the same reason.
 */
export function enoughHits(hits: number, of: number): boolean {
  return of > 0 && hits >= Math.max(Math.min(of, 2), Math.ceil(0.75 * of));
}

/** Kept step with the driver being asked about on (nearly) every other lap read. */
export function keptStep(o: CarOption): boolean {
  return !!o.movesWith?.mine && enoughHits(o.movesWith.hits, o.movesWith.of);
}

/** Every reason a picture is folded, strongest first. Two or more and it is not shown at all. */
export function foldReasons(o: CarOption): FoldReason[] {
  const out: FoldReason[] = [];
  if (o.movesWith && !o.movesWith.mine) out.push("other-car");
  if (o.outOfOrder) out.push("order");
  if (o.wrongWay) out.push("direction");
  if (o.offField) out.push("field");
  if (o.hint === "other") out.push("colour");
  if (o.offLine && !o.shortLine) out.push("off-line");
  return out;
}

export function foldReasonFor(o: CarOption): FoldReason | undefined {
  return foldReasons(o)[0];
}


/** Two passes this close together, in opposite directions, are one car at a hairpin. */
export const HAIRPIN_SEC = 3;

/**
 * Settle the driver's own car against the line's geometry, per line, once every other verdict is
 * in: which kept-step car beside the line is a short line's fault (`shortLine`), and which pair
 * on the line is a hairpin's two passes (`hairpin`).
 */
export function settleLineShape(options: CarOption[]): CarOption[] {
  const mine = options.filter((o) => keptStep(o) && !o.outOfOrder && !o.offField);
  const onLine = mine.filter((o) => !o.offLine);
  return options.map((o) => {
    if (!mine.includes(o)) return o;
    if (o.offLine) return onLine.length === 0 ? { ...o, shortLine: true } : o;
    const twin = onLine.find(
      (p) => p !== o && Math.abs(p.t - o.t) <= HAIRPIN_SEC && p.dir != null && o.dir != null && p.dir !== o.dir
    );
    return twin ? { ...o, hairpin: true } : o;
  });
}

/** The stretch of the lap in which the field crosses one line. */
export type FieldWindow = {
  fromSec: number;
  toSec: number;
  /** Distinct drivers whose crossings it was learnt from. */
  cars: number;
  /** Each of those drivers' own offset, soonest first — for the log, not the screen. */
  centres: number[];
  /** The way the field crosses this line, when the crossings behind the window agree. */
  dir?: 1 | -1;
};

export type LineOptions = {
  lineKey: string;
  label: string;
  /** Every car that crossed, soonest first. Empty means nothing crossed that the detector saw. */
  options: CarOption[];
  /** Where the field crosses this line, when enough of them were followed to say. */
  field?: FieldWindow;
};

export type IdentifyResult = {
  role: SessionRole;
  lapNumber: number;
  lapStartSec: number;
  lapTimeSec: number;
  lines: LineOptions[];
  framesRead: number;
  /**
   * The browser could not feed frames fast enough to see anything.
   *
   * Without this the screen says "nothing crossed this line", which is a different statement
   * entirely and a false one — the cars were there, the frames they were in never arrived.
   */
  starved: boolean;
  /** Frames per second of VIDEO the read actually managed, for the honest version of the message. */
  effectiveFps: number | null;
  /**
   * This driver's colour, learnt at the start line where the transponder names the car. Null when
   * too few clean start-line crossings were seen to say anything.
   */
  car: CarColour | null;
  /** How many other laps each picture was checked against for `movesWith`. */
  lapsChecked: number;
};

/** Two crossings this close are one car counted twice, not two cars. */
const SAME_CAR_SEC = 0.25;
/** Beyond this many cars per line the list stops being something anyone can read. */
const MAX_OPTIONS_PER_LINE = 8;
/** A colour learnt from fewer start-line crossings than this has no business hinting. */
const MIN_HINT_SAMPLES = 3;
/**
 * Below this much chroma apart, nothing is called a different car whatever the rivals looked
 * like. 0.10 is a different colour of car (see carColour.ts); the same car seen at the start line
 * and then at a corner has measured 0.09 apart on the Boronia footage.
 */
const OTHER_FLOOR = 0.1;
/** A picture at least this fraction of the rivals' distance from the reference is one of them. */
const OTHER_RIVAL_FRACTION = 0.75;
/** Whole laps read besides the identify lap, to see what each car keeps step with. */
const EXTRA_LAPS = 4;
/** A crossing this close to where a driver's timing predicts it is that driver's crossing. */
const STEP_TOL_SEC = 0.35;
/**
 * The least time between one corner and the next, and between the last corner and the line. A
 * tenth-scale car at the closest two lines anyone draws is still a few tenths apart.
 */
export const MIN_SECTOR_GAP_SEC = 0.3;
/**
 * How far past an end of the drawn line a crossing may sit and still be this corner, as a
 * fraction of the line's length. The detector's own band runs 0.35 past each end (see
 * types.ts `extend`); the drawn line is where the driver said the corner is.
 */
const ON_LINE_SLACK = 0.2;
/**
 * A car is about this long on the frame, and where along a line its blob's centre crossed is
 * only meaningful when the line is longer than the car. On a 14px line drawn across a track
 * that is 14px wide — "that's just how wide the track is" — the real crossing read as beside
 * the line and the hairpin's return pass as on it. Below this many pixels of slack, geometry
 * says nothing; the field's direction decides instead.
 */
const ON_LINE_SLACK_PX = 24;

/** Slack as a fraction of THIS line's length: a fifth, or a car's length, whichever is more. */
function onLineSlackFor(lengthPx: number): number {
  return Math.max(ON_LINE_SLACK, lengthPx > 0 ? ON_LINE_SLACK_PX / lengthPx : Number.POSITIVE_INFINITY);
}

/**
 * The lap worth showing: the driver's most ordinary one.
 *
 * Not their fastest. A quick lap is often quick because it was clear, and a lap with nobody else
 * in shot teaches nothing about telling cars apart. The median lap is the one that looks like the
 * race actually looked.
 */
export function lapToIdentifyOn(laps: LapInput[], role: SessionRole): LapInput | null {
  const mine = laps.filter((l) => l.role === role).sort((a, b) => a.lapTimeSec - b.lapTimeSec);
  if (mine.length === 0) return null;
  return mine[Math.floor((mine.length - 1) / 2)] ?? null;
}

/** The laps either side of the identify lap in the time order — as ordinary as it is. */
function lapsToCheckAgainst(laps: LapInput[], role: SessionRole, lap: LapInput): LapInput[] {
  const mine = laps.filter((l) => l.role === role).sort((a, b) => a.lapTimeSec - b.lapTimeSec);
  const i = mine.findIndex((l) => l.lapNumber === lap.lapNumber);
  if (i < 0) return [];
  const out: LapInput[] = [];
  for (let d = 1; out.length < EXTRA_LAPS && (i - d >= 0 || i + d < mine.length); d++) {
    if (i - d >= 0) out.push(mine[i - d]!);
    if (out.length < EXTRA_LAPS && i + d < mine.length) out.push(mine[i + d]!);
  }
  return out;
}

function dedupe(options: CarOption[]): CarOption[] {
  const sorted = [...options].sort((a, b) => a.t - b.t);
  const out: CarOption[] = [];
  for (const o of sorted) {
    const prev = out[out.length - 1];
    if (prev && o.t - prev.t < SAME_CAR_SEC) {
      // Keep whichever passed more convincingly; they are the same car either way.
      if (o.quality > prev.quality) out[out.length - 1] = o;
      continue;
    }
    out.push(o);
  }
  if (out.length <= MAX_OPTIONS_PER_LINE) return out;
  // Too many to show: keep the cleanest passes, then put them back in time order so the strip
  // still reads left to right as the lap ran.
  return [...out]
    .sort((a, b) => b.quality - a.quality)
    .slice(0, MAX_OPTIONS_PER_LINE)
    .sort((a, b) => a.t - b.t);
}

/**
 * What the start-line colour says about one picture.
 *
 * Measured on the Boronia race (2026-08-28): at the start line the pink car reads 0.49/0.31 with
 * a scatter of 0.003, yet the SAME car at the corners reads 0.41–0.45 — 0.04 to 0.09 away,
 * because it is nearer the camera at the start line and the blob holds more car and less
 * tarmac. Sandy's red car sits 0.07 from that reference; the grey and white cars 0.13–0.15. So
 * a start-line reference can tell "a colourful car" from "a grey one" — which is the very tap
 * that went wrong — and cannot tell pink from red. The rule says only that much:
 *
 *  - "other": the picture is at least as far from the reference as the rivals seen beside the
 *    car at the start line were (three quarters of their median distance), and never closer than
 *    0.10. Needs those rivals to have been seen (`colourUsable`), otherwise nothing is known
 *    about how far "different" is on this footage.
 *  - "yours": inside the reference's own tolerance, which after that 0.09 cross-line shift is
 *    rare — but when it fires it is right, and the field has been measured apart.
 */
export function hintFor(ref: CarColour | null, colour: Rgb | undefined): CarHint | undefined {
  if (!ref || !colour || ref.samples < MIN_HINT_SAMPLES || !colourUsable(ref)) return undefined;
  const d = chromaDistance(ref.chroma, chromaOf(colour));
  const rivals = rivalDistance(ref);
  if (rivals != null && d >= Math.max(OTHER_FLOOR, OTHER_RIVAL_FRACTION * rivals)) return "other";
  if (d <= toleranceFor(ref)) return "yours";
  return undefined;
}

/** One whole lap of one line as read: its window, and every crossing seen in it. */
export type ReadWindow = {
  fromSec: number;
  toSec: number;
  crossings: number[];
  /** Which way each crossing went, parallel to `crossings`; absent on data without directions. */
  dirs?: Array<1 | -1 | undefined>;
};

/**
 * Whose timing does a crossing keep step with?
 *
 * Take the crossing's offset from each driver's lap start (the lap that driver was on at that
 * moment). On every other window read, that driver's timing then predicts a time; a crossing
 * within `STEP_TOL_SEC` of it is a hit. The driver with the most hits is the answer — unless the
 * driver being asked about ties for it, in which case nothing is said: a rival running nose to
 * tail at a steady gap keeps step with both timings for a couple of laps, and that is exactly
 * when the picture, not the arithmetic, has to decide.
 */
export function movesWithFor(
  t: number,
  field: FieldDriver[],
  mineKey: string,
  others: ReadWindow[]
): MovesWith | undefined {
  if (others.length === 0) return undefined;
  const scored: Array<{ d: FieldDriver; hits: number; err: number }> = [];
  for (const d of field) {
    const starts = [...d.lapStarts].sort((a, b) => a.startSec - b.startSec);
    const on = [...starts].reverse().find((s) => s.startSec <= t);
    if (!on) continue;
    const offset = t - on.startSec;
    let hits = 0;
    let err = 0;
    for (const w of others) {
      // The lap of this driver whose predicted crossing lands inside the window, if any.
      const predicted = starts
        .map((s) => s.startSec + offset)
        .find((p) => p >= w.fromSec && p <= w.toSec);
      if (predicted == null) continue;
      let best = Number.POSITIVE_INFINITY;
      for (const c of w.crossings) best = Math.min(best, Math.abs(c - predicted));
      if (best <= STEP_TOL_SEC) {
        hits++;
        err += best;
      }
    }
    scored.push({ d, hits, err: hits ? err / hits : Number.POSITIVE_INFINITY });
  }
  const top = Math.max(0, ...scored.map((s) => s.hits));
  if (top === 0) return undefined;
  const leaders = scored.filter((s) => s.hits === top);
  const mine = leaders.find((s) => s.d.key === mineKey);
  // The asked-about driver shares the lead with somebody: not ours to call.
  if (mine && leaders.length > 1) return undefined;
  // Among rivals only, the one that predicted it most exactly.
  const pick = mine ?? leaders.sort((a, b) => a.err - b.err)[0]!;
  return { key: pick.d.key, name: pick.d.name, mine: pick.d.key === mineKey, hits: top, of: others.length };
}

/**
 * Fewer drivers than this behind a cluster say nothing about where the field crosses a line.
 * Two is enough: two different cars, each found on the line on every lap read, meeting it at the
 * same point in their laps is not a coincidence — and one of the two is usually the driver
 * themselves. Three left most lines without a window on the Boronia footage.
 */
export const MIN_FIELD_CARS = 2;
/**
 * How far outside the cluster a crossing may sit and still be this corner. The cluster is of the
 * drivers who happened to be followed; the one being asked about may be a tenth slower than all
 * of them, and how far into the lap a line comes scales with that — so the slack grows with the
 * offset, and never drops below what one car's length of luck is worth.
 */
const FIELD_SLACK_FRACTION = 0.2;
const FIELD_SLACK_FLOOR_SEC = 1.0;
/** Two drivers' offsets further apart than this are two different things, not one cluster. */
const FIELD_CLUSTER_GAP_SEC = 1.0;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/**
 * Every driver whose timing predicts this crossing on every other window read, with how far
 * into THAT driver's lap it came. Usually one; over three laps of a club heat, often two — cars
 * on lap times within a tenth of each other have not drifted apart yet, and the crossing fits
 * both. Nothing here chooses between them: the cluster step takes every reading, and a driver
 * counts once per cluster however many crossings put them there.
 */
function ownersOf(
  t: number,
  field: FieldDriver[],
  others: ReadWindow[]
): Array<{ key: string; offsetSec: number }> {
  const out: Array<{ key: string; offsetSec: number }> = [];
  for (const d of field) {
    const starts = [...d.lapStarts].sort((a, b) => a.startSec - b.startSec);
    const on = [...starts].reverse().find((s) => s.startSec <= t);
    if (!on) continue;
    const offsetSec = t - on.startSec;
    let hits = 0;
    for (const w of others) {
      const predicted = starts.map((s) => s.startSec + offsetSec).find((p) => p >= w.fromSec && p <= w.toSec);
      if (predicted == null) continue;
      let best = Number.POSITIVE_INFINITY;
      for (const c of w.crossings) best = Math.min(best, Math.abs(c - predicted));
      if (best <= STEP_TOL_SEC) hits++;
    }
    if (enoughHits(hits, others.length)) out.push({ key: d.key, offsetSec });
  }
  return out;
}

type Cluster = { lo: number; hi: number; centre: number; keys: string[]; dir?: 1 | -1 };
/** This share of a cluster's crossings must agree before the window has a direction. */
const DIR_AGREEMENT = 0.75;

/** Group one line's readings by offset; each driver's own median counts once per cluster. */
function clustersOf(readings: Array<{ key: string; offsetSec: number; dir?: 1 | -1 }>): Cluster[] {
  const sorted = [...readings].sort((a, b) => a.offsetSec - b.offsetSec);
  const groups: Array<typeof sorted> = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && r.offsetSec - g[g.length - 1]!.offsetSec <= FIELD_CLUSTER_GAP_SEC) g.push(r);
    else groups.push([r]);
  }
  return groups.map((g) => {
    const byKey = new Map<string, number[]>();
    for (const r of g) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.offsetSec]);
    const centres = [...byKey.values()].map(median).sort((a, b) => a - b);
    const dirs = g.map((r) => r.dir).filter((d): d is 1 | -1 => d != null);
    const plus = dirs.filter((d) => d === 1).length;
    const dir: 1 | -1 | undefined =
      dirs.length >= 2 && plus / dirs.length >= DIR_AGREEMENT ? 1 : dirs.length >= 2 && (dirs.length - plus) / dirs.length >= DIR_AGREEMENT ? -1 : undefined;
    return { lo: centres[0]!, hi: centres[centres.length - 1]!, centre: median(centres), keys: [...byKey.keys()], dir };
  });
}

/**
 * Where does the field cross each line?
 *
 * Every crossing in every window read, on every line, is asked whose timing it keeps step with —
 * exactly as the pictures are — and each answer says how far into that driver's lap this line
 * comes. Pooled across the field, a line's readings fall into clusters: the corner itself, which
 * every driver reaches at about the same point of their lap; and, on a fisheye, the OTHER piece
 * of track that passes under the same pixels, which every driver also reaches at about the same
 * (different) point. On the Boronia footage S1 had one cluster at three seconds and one at
 * sixteen, each backed by real drivers.
 *
 * Track order tells them apart. The lines are numbered in the order the car meets them, so the
 * true clusters climb from line to line with at least `minGap` between them, and a line's
 * cluster at sixteen seconds cannot precede the next line's at five. The chain of clusters with
 * the most drivers behind it, in order, is the field's lap; a line with no cluster in that chain
 * gets no window and folds nothing. "Median sector time per driver, or per race, to narrow the
 * search" — the driver, 2026-08-28. This is that.
 *
 * Returns one window per line, in the order given; null where nothing could be said.
 */
export function fieldWindowsFor(
  lines: ReadWindow[][],
  field: FieldDriver[],
  lapTimeSec: number,
  minGap = MIN_SECTOR_GAP_SEC
): Array<FieldWindow | null> {
  const perLine = lines.map((windows) => {
    const readings: Array<{ key: string; offsetSec: number; dir?: 1 | -1 }> = [];
    windows.forEach((w, i) => {
      const others = windows.filter((_, k) => k !== i);
      if (others.length === 0) return;
      w.crossings.forEach((t, k) => {
        const dir = w.dirs?.[k];
        for (const o of ownersOf(t, field, others)) readings.push({ ...o, dir });
      });
    });
    return clustersOf(readings).filter(
      (c) => c.keys.length >= MIN_FIELD_CARS && c.centre <= lapTimeSec + minGap
    );
  });

  // The chain of clusters, one per line at most, in track order, with the most drivers behind
  // it. Skipping a line is always allowed and earns nothing.
  const n = perLine.length;
  const memo = new Map<string, { support: number; picks: Array<Cluster | null> }>();
  const best = (i: number, prevLine: number, prev: Cluster | null): { support: number; picks: Array<Cluster | null> } => {
    if (i === n) return { support: 0, picks: [] };
    const key = `${i}|${prevLine}|${prev?.centre ?? ""}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let top = (() => {
      const r = best(i + 1, prevLine, prev);
      return { support: r.support, picks: [null, ...r.picks] };
    })();
    for (const c of perLine[i]!) {
      if (prev && c.centre < prev.centre + minGap * (i - prevLine)) continue;
      const r = best(i + 1, i, c);
      if (r.support + c.keys.length > top.support) top = { support: r.support + c.keys.length, picks: [c, ...r.picks] };
    }
    memo.set(key, top);
    return top;
  };
  return best(0, -1, null).picks.map((c) => {
    if (!c) return null;
    const slack = Math.max(FIELD_SLACK_FLOOR_SEC, FIELD_SLACK_FRACTION * c.centre);
    return {
      fromSec: Math.max(0, c.lo - slack),
      toSec: c.hi + slack,
      cars: c.keys.length,
      centres: [c.lo, c.centre, c.hi],
      ...(c.dir ? { dir: c.dir } : {}),
    };
  });
}

/**
 * Which crossings are out of track order?
 *
 * Lines in track order; each corner comes at least `minGap` after the one before, and the last
 * comes at least `minGap` before the lap ends. Judged against ANCHORS, not by chaining every
 * line: a first cut required a chain through every line that had any fitting crossing, and on
 * the Boronia footage one missed detection (the real S4 not seen on that lap) made two other
 * cars the "S4", after which the driver's real S1 was declared out of order. So:
 *
 *  - An anchor is a line with exactly ONE crossing that kept step with this driver on every
 *    other lap read (`sure`). Two such crossings on one line is a car nose to tail — no anchor.
 *  - Anchors must agree with each other in order; if they do not, one of them is wrong and none
 *    is used (the lap bounds still apply, and the driver's own taps narrow the rest live).
 *  - A crossing is out of order when it sits outside [0, lap − a gap per line still to come], or
 *    on the wrong side of an anchor on another line by less than a gap per line between them.
 *
 * Returns one flag per option, in the order given: true = out of order.
 */
export function orderFlags(
  lines: Array<Array<{ offsetSec: number; sure: boolean }>>,
  lapTimeSec: number,
  minGap = MIN_SECTOR_GAP_SEC
): boolean[][] {
  const anchors: Array<{ line: number; offsetSec: number }> = [];
  lines.forEach((opts, i) => {
    const sure = opts.filter((o) => o.sure);
    if (sure.length === 1) anchors.push({ line: i, offsetSec: sure[0]!.offsetSec });
  });
  const consistent = anchors.every(
    (a, k) => k === 0 || a.offsetSec >= anchors[k - 1]!.offsetSec + minGap
  );
  const useAnchors = consistent ? anchors : [];
  // Every line between an anchor and the crossing needs its own gap, and so does every line
  // between the crossing and the end of the lap: a car at the fifth line three seconds in would
  // have taken the second, third and fourth in eight tenths.
  const n = lines.length;
  return lines.map((opts, i) =>
    opts.map((o) => {
      if (o.offsetSec < 0 || o.offsetSec > lapTimeSec - minGap * (n - i)) return true;
      for (const a of useAnchors) {
        if (a.line < i && a.offsetSec + minGap * (i - a.line) > o.offsetSec) return true;
        if (a.line > i && a.offsetSec - minGap * (a.line - i) < o.offsetSec) return true;
      }
      return false;
    })
  );
}

export type IdentifyContext = {
  video: HTMLVideoElement;
  frameW: number;
  frameH: number;
  durationSec: number;
  lines: SessionLine[];
  laps: LapInput[];
  lapStart: LapStartFn;
  /** Everyone in the race with their lap starts — what each picture is checked against. */
  field?: FieldDriver[];
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
};

/**
 * Read the driver's most ordinary lap and keep every car that crossed each line.
 *
 * Deliberately no colour reference and no prediction in what is KEPT: filtering by "what we think
 * your car looks like" is exactly the assumption being checked, and choosing the nearest to a
 * predicted time is exactly the guess being replaced. The checks only annotate — and fold.
 */
export async function collectCarOptions(
  ctx: IdentifyContext,
  opts: { role: SessionRole; lapNumber?: number }
): Promise<IdentifyResult | null> {
  const { video, frameW, frameH, durationSec, lines, laps, lapStart, signal } = ctx;
  const lap =
    opts.lapNumber != null
      ? laps.find((l) => l.role === opts.role && l.lapNumber === opts.lapNumber) ?? null
      : lapToIdentifyOn(laps, opts.role);
  if (!lap) return null;

  const startSec = lapStart(lap.role, lap.lapNumber);
  if (startSec == null) return null;

  const cornerLines = lines
    .filter((l) => l.lineKey !== SF_LINE_KEY)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (cornerLines.length === 0) return null;

  const from = Math.max(0, startSec + 0.05);
  const to = Math.min(durationSec, startSec + lap.lapTimeSec - 0.05);
  if (to - from < 1) return null;

  // The identify lap, then the laps either side of it in the time order: the same whole-lap
  // read on each, so every car on the identify lap can be looked for again where each driver's
  // timing says it would be.
  const readLaps: Array<LapInput & { startSec: number; fromSec: number; toSec: number }> = [];
  for (const l of [lap, ...lapsToCheckAgainst(laps, lap.role, lap)]) {
    const s = lapStart(l.role, l.lapNumber);
    if (s == null) continue;
    const f = Math.max(0, s + 0.05);
    const e = Math.min(durationSec, s + l.lapTimeSec - 0.05);
    if (e - f < 1) continue;
    readLaps.push({ ...l, startSec: s, fromSec: f, toSec: e });
  }
  const targets: CrossingTarget[] = readLaps.flatMap((l) =>
    cornerLines.map((line) => ({
      id: targetId(l.role, l.lapNumber, line.lineKey),
      lineKey: line.lineKey,
      lapNumber: l.lapNumber,
      centerSec: (l.fromSec + l.toSec) / 2,
      truthSec: null,
      searchFrom: l.fromSec,
      searchTo: l.toSec,
    }))
  );

  // The start line on this driver's quickest few laps: half a second either side of a time the
  // transponder vouches for. A clean lap is where the car is most likely to be on its own there.
  const hasSf = lines.some((l) => l.lineKey === SF_LINE_KEY);
  const sfLaps = hasSf
    ? laps
        .filter((l) => l.role === lap.role)
        .sort((a, b) => a.lapTimeSec - b.lapTimeSec)
        .slice(0, BOOTSTRAP_LAPS)
        .map((l) => ({ ...l, startSec: lapStart(l.role, l.lapNumber) }))
        .filter((l): l is LapInput & { startSec: number } => l.startSec != null)
    : [];
  const sfTargets: CrossingTarget[] = sfLaps.map((l) => ({
    id: targetId(l.role, l.lapNumber, SF_LINE_KEY),
    lineKey: SF_LINE_KEY,
    lapNumber: l.lapNumber,
    centerSec: l.startSec,
    truthSec: l.startSec,
    searchFrom: Math.max(0, l.startSec - SF_WINDOW_SEC),
    searchTo: Math.min(durationSec, l.startSec + SF_WINDOW_SEC),
  }));

  const scan = await findCrossingsInBrowser({
    video,
    frameW,
    frameH,
    lines,
    targets: [...targets, ...sfTargets],
    onProgress: ctx.onProgress,
    signal,
  });

  // Only crossings that agree with the timing may teach the colour — the window still admits a
  // rival just behind, and on race footage that rival's paint became "yours" once already.
  const truthById = new Map(sfTargets.map((t) => [t.id, t.truthSec]));
  const car =
    carColoursFromLapStarts(
      scan.results.filter(
        (r) =>
          r.lineKey === SF_LINE_KEY &&
          r.detectedSec != null &&
          Math.abs(r.detectedSec - (truthById.get(r.id) ?? NaN)) <= SF_AGREE_SEC
      )
    )[lap.role] ?? null;

  // The field to check against: everyone with lap starts, this driver included even when the
  // screen passed nobody (a practice session) — then a picture can only be "yours" or unknown.
  const mineKey = lap.role;
  const field: FieldDriver[] = ctx.field?.some((d) => d.key === mineKey)
    ? ctx.field
    : [
        ...(ctx.field ?? []),
        {
          key: mineKey,
          name: "you",
          role: lap.role,
          lapStarts: laps
            .filter((l) => l.role === lap.role)
            .map((l) => ({ lapNumber: l.lapNumber, startSec: lapStart(l.role, l.lapNumber) }))
            .filter((l): l is { lapNumber: number; startSec: number } => l.startSec != null),
        },
      ];

  const resultFor = (lapNumber: number, lineKey: string) =>
    scan.results.find((r) => r.lineKey === lineKey && r.id === targetId(lap.role, lapNumber, lineKey));
  const candidatesOf = (lapNumber: number, lineKey: string): CrossingEvent[] =>
    resultFor(lapNumber, lineKey)?.candidates ?? [];

  const gaps = scan.segments.map((s) => s.medianMediaGapMs).filter((g) => Number.isFinite(g));
  const worstGap = gaps.length ? Math.max(...gaps) : null;
  const otherLaps = readLaps.filter((l) => l.lapNumber !== lap.lapNumber);

  const windowOf = (
    l: SessionLine,
    o: { lapNumber: number; fromSec: number; toSec: number },
    keep: (c: CrossingEvent) => boolean = () => true
  ): ReadWindow => ({
    fromSec: o.fromSec,
    toSec: o.toSec,
    crossings: candidatesOf(o.lapNumber, l.lineKey).filter(keep).map((c) => c.t),
    dirs: candidatesOf(o.lapNumber, l.lineKey).filter(keep).map((c) => c.dir),
  });
  // Where the field crosses each line, learnt from every window read — the identify lap too —
  // and only from crossings ON the line: a car passing beside it on the neighbouring track
  // repeats every lap just as faithfully, and on the Boronia footage that second cluster
  // stretched S1's window from three seconds to eight.
  const fieldWindows = fieldWindowsFor(
    cornerLines.map((l) => {
      const geom = lineGeom(l, frameW, frameH);
      const slack = onLineSlackFor(geom.norm);
      const onLine = (c: CrossingEvent): boolean => {
        if (c.x == null || c.y == null) return true;
        const along = alongLine(geom, c.x, c.y);
        return along >= -slack && along <= 1 + slack;
      };
      return readLaps.map((o) => windowOf(l, o, onLine));
    }),
    field,
    lap.lapTimeSec
  );

  const perLine = cornerLines.map((l, li): LineOptions => {
    const geom = lineGeom(l, frameW, frameH);
    const others = otherLaps.map((o) => windowOf(l, o));
    const fieldWindow = fieldWindows[li] ?? null;
    const raw = candidatesOf(lap.lapNumber, l.lineKey).map((c) => ({
      t: c.t,
      offsetSec: c.t - startSec,
      x: c.x,
      y: c.y,
      quality: c.quality,
      colour: c.colour,
      dir: c.dir,
    }));
    const slack = onLineSlackFor(geom.norm);
    const judged = dedupe(raw).map((o): CarOption => {
      const along = o.x != null && o.y != null ? alongLine(geom, o.x, o.y) : null;
      const base: CarOption = {
        ...o,
        hint: hintFor(car, o.colour),
        movesWith: movesWithFor(o.t, field, mineKey, others),
        offLine: along != null && (along < -slack || along > 1 + slack),
      };
      // The field's window says where the CORNER is; keeping step says whose CAR it is. They are
      // different questions, and a car that keeps step outside the window is this driver's car
      // at another point of the lap (their real S3 was 3.6s in; their own car through the same
      // pixels at 10.8s kept step just as well, and was picked). The window wins.
      const offField =
        fieldWindow != null && (o.offsetSec < fieldWindow.fromSec || o.offsetSec > fieldWindow.toSec);
      // Everyone crosses a corner the same way; the return leg of a hairpin goes the other way.
      const wrongWay = fieldWindow?.dir != null && o.dir != null && o.dir !== fieldWindow.dir;
      return { ...base, ...(offField ? { offField } : {}), ...(wrongWay ? { wrongWay } : {}) };
    });
    const options = settleLineShape(judged);
    return { lineKey: l.lineKey, label: l.label, options, field: fieldWindow ?? undefined };
  });

  // Track order, judged over the crossings still in play, against the sure anchors among them.
  const flags = orderFlags(
    perLine.map((l) =>
      l.options.map((o) => ({
        offsetSec: o.offsetSec,
        sure: foldReasonFor(o) == null && keptStep(o),
      }))
    ),
    lap.lapTimeSec
  );
  const lines_ = perLine.map((l, i) => ({
    ...l,
    options: l.options
      .map((o, k) => (flags[i]![k] && foldReasonFor(o) == null ? { ...o, outOfOrder: true } : o))
      // Ruled out twice over is not an option at all.
      .map((o) => (foldReasons(o).length >= 2 ? { ...o, dropped: true } : o)),
  }));

  return {
    role: lap.role,
    lapNumber: lap.lapNumber,
    lapStartSec: startSec,
    lapTimeSec: lap.lapTimeSec,
    framesRead: scan.framesRead,
    starved: scan.starvedSegments > 0,
    effectiveFps: worstGap && worstGap > 0 ? 1000 / worstGap : null,
    car,
    lapsChecked: otherLaps.length,
    lines: lines_,
  };
}

/**
 * What the screen should have picked before the driver touches anything: on each line, the one
 * car that kept step with this driver on every other lap read — and nothing else. "The only car
 * left" is not evidence: on the Boronia footage a lone unlabelled leftover at 0.87s was picked
 * as S3, and every other line was then judged against it. Everything else stays theirs to tap.
 */
export function defaultPicks(lines: LineOptions[]): Record<string, CarOption> {
  const picks: Record<string, CarOption> = {};
  for (const l of lines) {
    const left = l.options.filter((o) => foldReasonFor(o) == null && !o.dropped && !o.hairpin);
    const sure = left.filter(keptStep);
    if (sure.length === 1) picks[l.lineKey] = sure[0]!;
    // "The only one left" was worthless when the folds were weak (a lone stray at 0.87s was
    // picked as S3). With the field's window folding everything outside where the corner is,
    // the one car left inside it IS the corner: "if it knows that's it, why is it asking me?"
    else if (left.length === 1 && l.field) picks[l.lineKey] = left[0]!;
  }
  return picks;
}

/** Turn the driver's taps into the seed offsets the rest of the scan already understands. */
export function seedsFromChoices(chosen: Record<string, CarOption | undefined>): Record<string, number> {
  const seeds: Record<string, number> = {};
  for (const [lineKey, option] of Object.entries(chosen)) {
    if (option) seeds[lineKey] = option.offsetSec;
  }
  return seeds;
}
