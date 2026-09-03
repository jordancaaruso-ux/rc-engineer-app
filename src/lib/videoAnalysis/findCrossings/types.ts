/**
 * Automatic sector-line crossing detection — shared types.
 *
 * Port of the offline Python probe (`rc-autosnap-results/autosnap-me/loop_eval_me.py`,
 * validated 2026-07-21 at 5 ms median vs hand marks). The recipe name `b22-t14` is the
 * converged parameter set; the neighbours it was chosen over are kept in RECIPE_VARIANTS
 * so a re-validation can reproduce the same stability check.
 *
 * Doctrine: `docs/SECTOR_COMPARE_NORTH_STAR.md`, sequence in `docs/VIDEO_AUTO_SECTORS_PLAN.md`.
 */

/** A sector line in normalized frame coords (0..1), as stored on a camera profile. */
export type SectorLine = {
  lineKey: string;
  label: string;
  sortOrder: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Detector knobs. Frame-geometry values are fractions of the FULL frame width. */
export type DetectorParams = {
  /** Half-width of the band hugging the line, as a fraction of full frame width. */
  bandFrac: number;
  /** Extra reach past each end of the line, as a fraction of line length, on top of the end cap. */
  extend: number;
  /**
   * How far past each end the band reaches, in band widths. 1 is the historic fixed car-length
   * cap; 0 stops the watched pixels dead at the drawn ends.
   */
  endCapBands?: number;
  /**
   * Ceiling on the band half-width as a fraction of THIS line's length, applied on top of
   * `bandFrac`. A fraction of frame width is one pixel count for the whole picture, but a far
   * corner has a fraction of the near straight's pixels per metre, so the same band that is a
   * car wide up close spans both directions of a distant hairpin. The line's own length is the
   * local scale — it is drawn across the track, and track width barely varies.
   */
  bandLineFrac?: number;
  /**
   * Floor on the band half-width, in frame pixels. It exists so there are enough pixels left to
   * blur and blob; on a corner drawn 36px across at 4K it is what stops the zone shrinking, and
   * it is the reason the shortest lines still look like a bubble rather than a strip.
   */
  minBandPx?: number;
  /**
   * How far past an end a crossing may LAND and still count, in band widths. The sign test uses
   * the infinite line, so without this the mask's shape is the only thing keeping a car in the
   * next lane from reading as a crossing of this one. Undefined leaves the position unchecked.
   */
  onLineSlackBands?: number;
  /** Frame-to-frame channel difference above which a pixel counts as moving. */
  thresh: number;
  /** Minimum contour area (OpenCV `contourArea`, not pixel count) for a blob to count. */
  minArea: number;
  /** Gaussian blur kernel size: the LARGEST used. 5 is the validated recipe. */
  blur: number;
  /**
   * Pick the kernel per line from the line's own pixel length — full blur on a long line, less
   * or none on one so short the car is only a few pixels across (`blurKernelFor`).
   */
  blurByLine?: boolean;
  /**
   * Also admit a band pixel that differs from the learnt empty track by more than
   * `thresh × this`. Frame-to-frame difference is blind to a slow, small car; the background is
   * not. Undefined keeps the detector frame-to-frame only.
   */
  bgGateMultiple?: number;
  /**
   * How the background starts: the per-pixel median of the opening frames (default), or a copy
   * of the first frame. Kept as a knob so the harness can grade the two apart.
   */
  bgInit?: "median" | "first";
  /** How a crossing is chosen from the candidate events in a window. */
  select: "nearest";
};

/**
 * The converged recipe. Do not change without re-running the validation harness.
 *
 * `extend` was 0.35 from July to 2026-08-29: the band ran a third of the line past each end so a
 * car clipping just beyond a line still counted. On a long line that was harmless; on the short
 * lines a fisheye shot forces (Test A3 S1: 80px at 1080p, shorter than the band is wide) it turned
 * the line into a box, and crossings scattered across 1.8s. A line now ends where the driver
 * ended it — Jordan, 2026-08-29: "the detector line needs to be where you draw it, period."
 * The band itself still runs one band-width past each end (see `bandMask`): a fixed car-length
 * cap, so a car reaching the line at its tip is seen on both sides, without a short line growing
 * into a box.
 */
export const RECIPE_B22_T14: DetectorParams = {
  bandFrac: 0.022,
  extend: 0,
  thresh: 14,
  minArea: 12,
  blur: 5,
  select: "nearest",
};

/**
 * Candidate: the zone bounded by the line the driver drew.
 *
 * Three changes over `b22-t14`, aimed at the far-hairpin failure (Jordan, 2026-09-01, with a
 * picture of three corners whose watched zones overlapped each other and both directions of a
 * hairpin):
 *
 *   1. `onLineSlackBands` — a flip only counts if it LANDS between the two ends, give or take
 *      half a car. Nothing else in the scan ever checked this; the sign test runs against the
 *      infinite line, so a car in the return lane crossed it just as convincingly.
 *   2. `bandLineFrac` — the band is at most 15% of the line's own length. A car is roughly a
 *      tenth of a track's width, and it moves under a car length between frames, so this keeps
 *      the strip about a car wide wherever it sits in the picture.
 *   3. `endCapBands` — kept at 1 so a car crossing at the very tip is still SEEN either side
 *      (the Test A3 S1 case the cap was added for). With rule 1 in place the cap can no longer
 *      admit a crossing, it only lets one be measured.
 *
 * Not production until it beats `b22-t14` on `scripts/find-crossings-validate.ts`.
 */
export const RECIPE_SEGMENT: DetectorParams = {
  ...RECIPE_B22_T14,
  bandLineFrac: 0.15,
  endCapBands: 1,
  onLineSlackBands: 0.5,
};

/**
 * The segment recipe, read the way a far line needs reading.
 *
 * Bendigo S1, 2026-09-02, measured frame by frame: at the far end of a 1080p fisheye the car is
 * four pixels on a tan strip near its own tone, moving two pixels a frame. Frame-to-frame
 * difference after the 5-tap blur put it at 6–10 levels against a gate of 8 — one car seen on
 * 8 laps of 10, the other on none, and every S1 the rival was handed was somebody else's car.
 * The same pass reads 15–24 raw. So the blur is chosen per line (`blurKernelFor`): none on a
 * line that short, and the gate is measured under whatever blur the line gets (`calibrate.ts`).
 * Graded on that footage: the rival's S1 went from 0 of 9 laps to 16 of 17, fifteen of them
 * within four tenths of each other; the 4K hand marks and the 18 Bendigo hand marks held.
 *
 * NOT in this recipe, though built and kept behind `bgGateMultiple`: comparing each pixel with
 * the learnt empty track as well (`motionMaskInBandBg`). It is the one test whose signal does
 * not shrink with speed, and it found the one lap the blur change still misses — a car crawling
 * through S1 at the noise floor. But even with a median start, learning only from real change,
 * and a blob required to contain real change, it invented crossings where a car stops in the
 * band at the end of a session, and more than doubled the rows held back. One lap is not worth
 * that. It is here for the harness, off by default.
 */
export const RECIPE_FAR: DetectorParams = {
  ...RECIPE_SEGMENT,
  blurByLine: true,
};

/**
 * The recipe the app runs, and the one the drawing screen draws. One name, so the patch a driver
 * sees while placing a line is the patch the scan reads — they drifted apart once already.
 */
export const ACTIVE_RECIPE: DetectorParams = RECIPE_FAR;

/**
 * The zone as small as the geometry allows: nothing past the ends at all, and the floor dropped
 * so a far corner is watched as a strip rather than a bubble. Jordan on sight of the drawn
 * shape, 2026-09-01: "still big issues here".
 */
export const RECIPE_SEGMENT_TIGHT: DetectorParams = {
  ...RECIPE_SEGMENT,
  endCapBands: 0,
  minBandPx: 10,
};

/** Neighbours the primary was chosen over — kept as a stability check, not for production. */
export const RECIPE_VARIANTS: Record<string, DetectorParams> = {
  "b22-t12": { ...RECIPE_B22_T14, thresh: 12 },
  "b22-t14": RECIPE_B22_T14,
  "b22-t16": { ...RECIPE_B22_T14, thresh: 16 },
  "b27-t14": { ...RECIPE_B22_T14, bandFrac: 0.027 },
  /** The whole segment idea. */
  segment: RECIPE_SEGMENT,
  /** Its parts, so the harness can say which one earned the change. */
  "seg-gate": { ...RECIPE_B22_T14, onLineSlackBands: 0.5 },
  "seg-thin": { ...RECIPE_B22_T14, bandLineFrac: 0.15 },
  "seg-nocap": { ...RECIPE_B22_T14, endCapBands: 0 },
  /** Jordan's literal ask: perpendicular only, nothing past the ends, no gate. */
  "seg-perp": { ...RECIPE_B22_T14, endCapBands: 0, bandLineFrac: 0.15 },
  /**
   * The zone as small as the geometry allows: no reach past the ends, and the floor dropped so
   * a far corner is a strip rather than a bubble. Asked for on sight of the drawn shape —
   * "still big issues here", 2026-09-01.
   */
  "seg-tight": RECIPE_SEGMENT_TIGHT,
  /** The far-line work, and the background test it deliberately leaves out. */
  far: RECIPE_FAR,
  "far-bg": { ...RECIPE_FAR, bgGateMultiple: 1.0 },
  "far-bg-first": { ...RECIPE_FAR, bgGateMultiple: 1.0, bgInit: "first" },
  /**
   * The floor is what governs the shortest lines — on the probe session S1, S4 and S5 are all
   * pinned to it, so it, not `bandLineFrac`, decides whether those corners are found. Swept
   * either side of 20 to find where accuracy and detection rate stop trading against each other.
   */
  "seg-floor28": {
    ...RECIPE_B22_T14,
    bandLineFrac: 0.15,
    endCapBands: 0,
    minBandPx: 28,
    onLineSlackBands: 0.5,
  },
  /** Same, but keeping the tip cap — so the floor and the cap can be blamed separately. */
  "seg-floor10": {
    ...RECIPE_B22_T14,
    bandLineFrac: 0.15,
    endCapBands: 1,
    minBandPx: 10,
    onLineSlackBands: 0.5,
  },
};

/**
 * Window geometry around a line. The ROI is deliberately wider than the band: the band
 * decides which pixels count, the ROI decides which pixels get decoded at all.
 */
export const ROI_PAD_FRAC = 0.055;
export const ROI_LINE_EXTEND = 0.5;

/** Pixel rectangle in full-frame coords, half-open on x1/y1. */
export type Roi = { x0: number; y0: number; x1: number; y1: number };

/** One decoded crop. `channels` is 3 (rgb24 from ffmpeg) or 4 (RGBA from a canvas/VideoFrame). */
export type FrameCrop = {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
};

/**
 * Signed distance of the nearest moving blob to the line, at one frame time — and where in the
 * frame it was.
 *
 * The position is what lets a crossing be SHOWN rather than described. A driver can settle in one
 * glance which of three cars was theirs; no amount of "2.84s into the lap, agreed on 4 laps" will
 * ever do that.
 */
export type BandSample = { t: number; signed: number; x: number; y: number };

/**
 * A sign flip between two consecutive samples — the car passing the line.
 * `quality` counts how many neighbouring samples agree with each side (max 10).
 */
export type CrossingEvent = {
  t: number;
  quality: number;
  /** Where the crossing happened, in frame pixels — absent only on data built before positions. */
  x?: number;
  y?: number;
  /** What colour the thing that crossed was, when the frame was read in colour. */
  colour?: { r: number; g: number; b: number };
  /**
   * Which way it crossed: the sign of the line's signed distance it ended up on. At a hairpin
   * the car crosses the same short line twice a lap in opposite directions, and only one of the
   * two is the corner the driver drew. Absent on data built before directions.
   */
  dir?: 1 | -1;
  /**
   * How sure the window was of this one. "confirmed" is a frame-pair flip with a car-like track
   * crossing at the same moment; "rescued" is a car-like track that crossed with no flip of its
   * own — the nearest-blob trace was watching another car at the time; "unconfirmed" is a bare
   * flip nothing tracked. Absent on data built before sources were kept per candidate, when the
   * row's own source applied to all of them.
   */
  source?: "confirmed" | "rescued" | "unconfirmed";
};

/** One thing the detector is asked to find: a line, and roughly when to look. */
export type CrossingTarget = {
  /** Stable id, e.g. `s3-L7` or `sf-b12`. */
  id: string;
  lineKey: string;
  /** Lap this crossing is binned to — by SF interval, never by corner order. */
  lapNumber: number;
  /** Predicted video time; the detector picks the event nearest this. */
  centerSec: number;
  /** Known-correct time where one exists (SF boundaries from the transponder). */
  truthSec: number | null;
  /**
   * Explicit stretch of video to read, overriding the default window either side of centerSec.
   *
   * Two things need this. A lap where the driver lost several seconds needs a wider search than a
   * clean one — and the timing sheet already says which laps those are. And a corner missed on the
   * first pass can be BRACKETED between the corners either side of it, which is not a guess at all:
   * whatever the driver did, the crossing is somewhere in there.
   */
  searchFrom?: number;
  searchTo?: number;
};

/** What the detector returns for one target. */
export type CrossingResult = CrossingTarget & {
  /** Detected video time, or null when no sign flip was found in the window. */
  detectedSec: number | null;
  /** How many candidate events the window contained. */
  eventCount: number;
  /** Quality of the chosen event (see CrossingEvent). */
  quality: number | null;
};
