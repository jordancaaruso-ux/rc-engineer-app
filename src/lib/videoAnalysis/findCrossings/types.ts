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
  /** Extra reach past each end of the line, as a fraction of line length, on top of the fixed one-band-width cap. */
  extend: number;
  /** Frame-to-frame channel difference above which a pixel counts as moving. */
  thresh: number;
  /** Minimum contour area (OpenCV `contourArea`, not pixel count) for a blob to count. */
  minArea: number;
  /** Gaussian blur kernel size. Only 5 is validated. */
  blur: number;
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

/** Neighbours the primary was chosen over — kept as a stability check, not for production. */
export const RECIPE_VARIANTS: Record<string, DetectorParams> = {
  "b22-t12": { ...RECIPE_B22_T14, thresh: 12 },
  "b22-t14": RECIPE_B22_T14,
  "b22-t16": { ...RECIPE_B22_T14, thresh: 16 },
  "b27-t14": { ...RECIPE_B22_T14, bandFrac: 0.027 },
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
