/**
 * The crossing detector itself: frames in, a time the car crossed the line out.
 *
 * The idea in one line — track which SIDE of the line the nearest moving thing is on, and the
 * crossing is the instant that sign flips. Because we know how far past the line each frame
 * landed, the flip is interpolated BETWEEN frames, which is how the offline probe beat hand
 * marks (a thumb can only land on a frame; this lands between two).
 *
 * Frames are pushed one at a time rather than collected: a six-second window of a 4K ROI is
 * hundreds of megabytes if you hold it all, and nothing here needs more than the previous frame.
 */

import { dilate5, findBlobs, gaussianBlur5, motionMaskInBand } from "./imageOps";
import { bandMask, lineGeom, roiFor, signedDistance } from "./geometry";
import { expandSpans, spanArea, spansFromMask, type RowSpans } from "./spans";
import {
  buildTracks,
  defaultTrackerConfig,
  frameMotions,
  trackCrossings,
  type FrameObs,
  type TrackerConfig,
} from "./tracks";
import { chromaDistance, chromaOf, type CarColour, type Rgb } from "./carColour";
import type {
  BandSample,
  CrossingEvent,
  CrossingResult,
  CrossingTarget,
  DetectorParams,
  FrameCrop,
  Roi,
  SectorLine,
} from "./types";

/** Two consecutive samples further apart than this are not a crossing — a decode gap. */
const MAX_SAMPLE_GAP_SEC = 0.12;
/**
 * Half-width of the patch averaged to say what colour a moving thing is.
 *
 * Read around the blob's centre rather than over its whole shape: a motion blob spans where the
 * car was and where it now is, so its outer parts are mostly track. The middle is the car.
 */
const COLOUR_PATCH = 5;
/** How far either side of a flip we look for agreeing samples, when scoring confidence. */
const QUALITY_WINDOW_SEC = 0.4;
const QUALITY_NEIGHBOURS = 5;
const DILATE_ITERATIONS = 2;

/**
 * Streams frames of one window and accumulates the signed-distance trace.
 * Push frames in time order; read `samples` when the window is done.
 */
export class WindowScanner {
  readonly samples: BandSample[] = [];
  /**
   * Every moving blob per frame, not just the nearest. The nearest-only trace stays the
   * measurement; this is what lets `tracks.ts` ask whether the thing that flipped was one
   * object moving, and rescue a crossing the nearest-only trace never saw.
   */
  readonly frames: FrameObs[] = [];

  private readonly band: Uint8Array;
  private readonly bandSpans: RowSpans;
  private readonly horizSpans: RowSpans;
  private readonly dilateSpans: RowSpans[];
  private readonly roiW: number;
  private readonly roiH: number;
  private readonly geom: ReturnType<typeof lineGeom>;

  private readonly horiz: Int32Array;
  private readonly blur: [Uint8Array, Uint8Array];
  private readonly motion: Uint8Array;
  private readonly dilBuf: { a: Uint8Array; b: Uint8Array; horiz: Uint8Array };
  private readonly seen: Uint8Array;
  private readonly stack: Int32Array;

  private frameIndex = 0;
  private hasPrev = false;
  private readonly bandHalfPx: number;
  /**
   * What the crop looks like with nothing moving in it — RGB per pixel, learnt as the window
   * plays, updated only where nothing is moving so a car is never learnt as track. This is what
   * makes a colour sample the CAR: a motion blob spans where the car was and where it now is, so
   * its centre is mostly tarmac; the pixels inside the blob that differ from this background are
   * the car itself, wherever in the blob it sits.
   */
  private bg: Float32Array | null = null;

  constructor(
    line: SectorLine,
    private readonly roi: Roi,
    frameW: number,
    frameH: number,
    private readonly params: DetectorParams,
    channels = 3
  ) {
    this.roiW = roi.x1 - roi.x0;
    this.roiH = roi.y1 - roi.y0;
    this.geom = lineGeom(line, frameW, frameH);
    this.band = bandMask(line, roi, frameW, frameH, params);
    this.bandHalfPx = params.bandFrac * frameW;

    this.bandSpans = spansFromMask(this.band, this.roiW, this.roiH);
    this.horizSpans = expandSpans(this.bandSpans, 2);
    this.dilateSpans = Array.from({ length: DILATE_ITERATIONS }, (_, i) =>
      expandSpans(this.bandSpans, 2 * (i + 1))
    );

    const px = this.roiW * this.roiH;
    const bytes = px * channels;
    this.horiz = new Int32Array(bytes);
    this.blur = [new Uint8Array(bytes), new Uint8Array(bytes)];
    this.motion = new Uint8Array(px);
    this.dilBuf = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
    this.seen = new Uint8Array(px);
    this.stack = new Int32Array(px);
  }

  /** Pixels actually visited per frame — useful when deciding whether a device can keep up. */
  get workPixels(): number {
    return spanArea(this.bandSpans);
  }

  /**
   * @param frame ROI crop the motion is measured on — brightness or colour, per calibration.
   * @param t Video time of THIS frame.
   * @param colourFrame Optional full-colour view of the SAME crop. Only used to read what colour
   *        each moving thing is; the detection itself never looks at it. Supplied even when the
   *        motion channel is brightness, because knowing WHICH car crossed and NOTICING that
   *        something crossed are different jobs and want different pictures.
   */
  push(frame: FrameCrop, t: number, colourFrame?: FrameCrop): void {
    const curIdx = this.frameIndex % 2;
    const prevIdx = (this.frameIndex + 1) % 2;
    this.frameIndex++;

    const blurred = gaussianBlur5(frame, this.bandSpans, this.horizSpans, {
      horiz: this.horiz,
      out: this.blur[curIdx],
    });
    if (!this.hasPrev) {
      this.hasPrev = true;
      return;
    }
    const prev: FrameCrop = {
      width: this.roiW,
      height: this.roiH,
      channels: frame.channels,
      data: this.blur[prevIdx],
    };

    motionMaskInBand(prev, blurred, this.params.thresh, this.band, this.bandSpans, this.motion);
    const grown = dilate5(this.motion, this.roiW, this.roiH, this.dilateSpans, this.dilBuf);

    const blobs = findBlobs(
      grown,
      this.roiW,
      this.roiH,
      this.params.minArea,
      this.dilateSpans[DILATE_ITERATIONS - 1],
      this.seen,
      this.stack
    );

    const fgSpans = this.dilateSpans[DILATE_ITERATIONS - 1];
    if (colourFrame && colourFrame.channels >= 3 && !this.bg) {
      this.bg = initBackground(colourFrame, fgSpans);
    }

    let nearest: number | null = null;
    let nearestX = 0;
    let nearestY = 0;
    const obs: FrameObs = { t, blobs: [] };
    for (const b of blobs) {
      const x = b.cx + this.roi.x0;
      const y = b.cy + this.roi.y0;
      const signed = signedDistance(this.geom, x, y);
      obs.blobs.push({
        x,
        y,
        area: b.area,
        signed,
        colour: colourFrame
          ? (this.bg && carColourAt(colourFrame, this.bg, grown, b, this.params.thresh)) ??
            meanColourAt(colourFrame, b.cx, b.cy)
          : undefined,
      });
      if (nearest == null || Math.abs(signed) < Math.abs(nearest)) {
        nearest = signed;
        nearestX = x;
        nearestY = y;
      }
    }
    if (obs.blobs.length) this.frames.push(obs);
    if (nearest != null) this.samples.push({ t, signed: nearest, x: nearestX, y: nearestY });

    // Learn the background from this frame — everywhere nothing moved. Done after sampling, so
    // the frame's own cars were judged against a background that did not yet include them.
    if (colourFrame && this.bg) updateBackground(this.bg, colourFrame, grown, fgSpans);
  }

  /** Tracker settings scaled to this line's band, so nothing is tuned to one resolution. */
  get trackerConfig(): TrackerConfig {
    return defaultTrackerConfig(this.bandHalfPx);
  }
}

/** How quickly the background follows a change in the light. ~10 frames to settle. */
const BG_ALPHA = 0.15;
/** A pixel must differ from the background by at least this much, on some channel, to be car. */
const BG_MIN_FG_DIFF = 24;
/** Fewer car pixels than this and the sample is not trusted over the plain patch. */
const MIN_CAR_PIXELS = 16;

/** The first frame is the background until something better is learnt. RGB only, spans only. */
function initBackground(frame: FrameCrop, spans: RowSpans): Float32Array {
  const c = frame.channels;
  const bg = new Float32Array(frame.width * frame.height * 3);
  for (let y = 0; y < spans.h; y++) {
    const from = spans.x0[y];
    const to = spans.x1[y];
    for (let x = from; x < to; x++) {
      const p = y * frame.width + x;
      const i = p * c;
      bg[p * 3] = frame.data[i];
      bg[p * 3 + 1] = frame.data[i + 1];
      bg[p * 3 + 2] = frame.data[i + 2];
    }
  }
  return bg;
}

/** Move the background toward this frame wherever nothing is moving. A car is never learnt. */
function updateBackground(bg: Float32Array, frame: FrameCrop, moving: Uint8Array, spans: RowSpans): void {
  const c = frame.channels;
  for (let y = 0; y < spans.h; y++) {
    const from = spans.x0[y];
    const to = spans.x1[y];
    for (let x = from; x < to; x++) {
      const p = y * frame.width + x;
      if (moving[p]) continue;
      const i = p * c;
      const q = p * 3;
      bg[q] += BG_ALPHA * (frame.data[i] - bg[q]);
      bg[q + 1] += BG_ALPHA * (frame.data[i + 1] - bg[q + 1]);
      bg[q + 2] += BG_ALPHA * (frame.data[i + 2] - bg[q + 2]);
    }
  }
}

/**
 * The colour of the CAR inside a motion blob: the moving pixels around the blob that differ from
 * the learnt background. Falls back to nothing when too few pixels qualify — the caller then uses
 * the plain patch, as before.
 */
function carColourAt(
  frame: FrameCrop,
  bg: Float32Array,
  moving: Uint8Array,
  blob: { cx: number; cy: number; area: number },
  thresh: number
): Rgb | undefined {
  const c = frame.channels;
  const fg = Math.max(BG_MIN_FG_DIFF, thresh);
  // The blob is the smear of old and new position; a box a little wider than its extent covers
  // the car wherever in the smear it sits.
  const radius = Math.max(COLOUR_PATCH * 2, Math.round(Math.sqrt(blob.area) * 0.75));
  const x0 = Math.max(0, Math.round(blob.cx) - radius);
  const x1 = Math.min(frame.width - 1, Math.round(blob.cx) + radius);
  const y0 = Math.max(0, Math.round(blob.cy) - radius);
  const y1 = Math.min(frame.height - 1, Math.round(blob.cy) + radius);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * frame.width + x;
      if (!moving[p]) continue;
      const i = p * c;
      const q = p * 3;
      const dr = Math.abs(frame.data[i] - bg[q]);
      const dg = Math.abs(frame.data[i + 1] - bg[q + 1]);
      const db = Math.abs(frame.data[i + 2] - bg[q + 2]);
      if (dr < fg && dg < fg && db < fg) continue;
      r += frame.data[i];
      g += frame.data[i + 1];
      b += frame.data[i + 2];
      n++;
    }
  }
  if (n < MIN_CAR_PIXELS) return undefined;
  return { r: r / n, g: g / n, b: b / n };
}

/** Mean colour of a small patch of the crop, centred on a blob. Crop coords, not frame coords. */
function meanColourAt(frame: FrameCrop, cx: number, cy: number): Rgb | undefined {
  const c = frame.channels;
  if (c < 3) return undefined;
  const x0 = Math.max(0, Math.round(cx) - COLOUR_PATCH);
  const x1 = Math.min(frame.width - 1, Math.round(cx) + COLOUR_PATCH);
  const y0 = Math.max(0, Math.round(cy) - COLOUR_PATCH);
  const y1 = Math.min(frame.height - 1, Math.round(cy) + COLOUR_PATCH);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    let i = (y * frame.width + x0) * c;
    for (let x = x0; x <= x1; x++, i += c) {
      r += frame.data[i];
      g += frame.data[i + 1];
      b += frame.data[i + 2];
      n++;
    }
  }
  if (!n) return undefined;
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Sign flips in the signed-distance trace, each interpolated to sub-frame precision.
 * `quality` is how many nearby samples sit on the expected side — a clean pass scores high,
 * a single flickering blob scores low.
 */
export function eventsFromSamples(samples: BandSample[]): CrossingEvent[] {
  const events: CrossingEvent[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.signed === 0 || b.signed === 0) continue;
    if (a.signed < 0 === b.signed < 0) continue;
    if (b.t - a.t > MAX_SAMPLE_GAP_SEC) continue;

    const frac = Math.abs(a.signed) / (Math.abs(a.signed) + Math.abs(b.signed));

    let before = 0;
    for (let j = Math.max(0, i - QUALITY_NEIGHBOURS); j < i; j++) {
      const s = samples[j];
      if (s.signed < 0 === a.signed < 0 && a.t - s.t < QUALITY_WINDOW_SEC) before++;
    }
    let after = 0;
    for (let j = i; j < Math.min(samples.length, i + QUALITY_NEIGHBOURS); j++) {
      const s = samples[j];
      if (s.signed < 0 === b.signed < 0 && s.t - b.t < QUALITY_WINDOW_SEC) after++;
    }

    events.push({
      t: a.t + frac * (b.t - a.t),
      quality: before + after,
      // The same interpolation the time gets: the car is between the two frames, so its position
      // is too. Good enough to crop a picture around, which is all this is for.
      x: a.x + frac * (b.x - a.x),
      y: a.y + frac * (b.y - a.y),
      dir: b.signed > 0 ? 1 : -1,
    });
  }
  return events;
}

/**
 * Choose the crossing from the candidates. `nearest` wins because we already know roughly when
 * the car should be here — from the transponder lap list — so the prediction is a far stronger
 * signal than anything in the picture.
 */
export function pickCrossing(
  events: CrossingEvent[],
  centerSec: number,
  qualityFloor = 0
): CrossingEvent | null {
  // A band over plain tarmac only ever moves when a car is in it. A band over kerbing, painted
  // markings or a grass edge fires on camera micro-shake in EVERY frame, which throws up dozens
  // of one-frame sign flips — and one of them is usually nearer the prediction than the real
  // crossing. Those flips are isolated; a car sits cleanly on one side then cleanly on the other.
  // That is what `quality` measures, so ignoring it is what makes line placement so decisive.
  const eligible = qualityFloor > 0 ? events.filter((e) => e.quality >= qualityFloor) : events;
  const pool = eligible.length ? eligible : events;

  let best: CrossingEvent | null = null;
  for (const e of pool) {
    if (!best || Math.abs(e.t - centerSec) < Math.abs(best.t - centerSec)) best = e;
  }
  return best;
}

/** Convenience: turn one finished window's samples into a result for its target. */
export function resultFromSamples(
  target: CrossingTarget,
  samples: BandSample[],
  qualityFloor = 0
): CrossingResult {
  const events = eventsFromSamples(samples);
  const picked = pickCrossing(events, target.centerSec, qualityFloor);
  return {
    ...target,
    detectedSec: picked ? picked.t : null,
    eventCount: events.length,
    quality: picked ? picked.quality : null,
  };
}

/** How close a track's crossing must be to a frame-pair event to count as the same crossing. */
const TRACK_MATCH_SEC = 0.05;

/** Where the chosen time came from, so a result can explain itself. */
export type CrossingSource = "confirmed" | "rescued" | "unconfirmed";

export type TrackedResult = CrossingResult & {
  source: CrossingSource | null;
  /** Candidate events the window produced, before tracking had a say. */
  rawEventCount: number;
  /** Crossings belonging to a single object that moved like a car. */
  trackCrossingCount: number;
  /** The candidates left after tracking — what a second pass is allowed to choose from. */
  candidates: CrossingEvent[];
  /** Colour of the thing that crossed, when the frame was read in colour. */
  colour?: Rgb;
  /**
   * Colour of EACH surviving candidate, aligned with `candidates`.
   *
   * The chosen crossing's colour is no stand-in for the others: the usual reason a window has
   * more than one candidate is that more than one car went through it, and those are exactly the
   * ones that need telling apart.
   */
  candidateColours: Array<Rgb | undefined>;
  /** Candidates thrown out for being the wrong colour car. */
  colourRejected: number;
};

/**
 * The full read of one window: frame-pair events, filtered and topped up by tracking.
 *
 * Three outcomes, in order of preference:
 *
 *   1. **confirmed** — a frame-pair event with a car-like track crossing at the same moment.
 *      The time reported is the event's own, unchanged, so a crossing that was already right
 *      stays bit-for-bit right; tracking's only job here is to throw away its rivals.
 *   2. **rescued** — no event survived, but a car-like track did cross. The time comes from the
 *      track. This is the case the nearest-only trace reports as not found.
 *   3. **unconfirmed** — nothing was tracked well enough to judge. The raw frame-pair flickers
 *      are still reported, so the screen can show them and a driver can point at one, but they
 *      are never written as a mark on their own (see `reviewResults`). This used to fall through
 *      to the old behaviour silently — the back door the whole "moves like a car" test was
 *      bypassed by. On a line drawn over kerbing, the car-like paths were discarded, nothing was
 *      left, and the flickers went through with no movement test at all.
 *
 * Colour never removes a candidate; it only orders them. The stored reference is mostly tarmac
 * (sampled at the centre of a motion blob), so as a gate it threw away the real car on exactly the
 * lines where the car crossed something that was not tarmac, and kept a patch of shaken paint that
 * was. As a tiebreak between two otherwise-plausible cars it can help; as a gate it could only hurt.
 */
export function resultFromWindow(
  target: CrossingTarget,
  samples: BandSample[],
  frames: FrameObs[],
  cfg: TrackerConfig,
  opts: { qualityFloor?: number; car?: CarColour | null } = {}
): TrackedResult {
  const { qualityFloor = 0, car = null } = opts;
  const events = eventsFromSamples(samples);
  const tracks = buildTracks(frames, cfg);
  const motions = frameMotions(frames, cfg.maxSpeedPxPerSec * cfg.maxGapSec);
  const crossings = trackCrossings(tracks, cfg, true, motions);
  const colourRejected = 0;

  const confirmedPairs = events
    .map((e) => ({
      event: e,
      track: crossings.find((c) => Math.abs(c.t - e.t) <= TRACK_MATCH_SEC) ?? null,
    }))
    .filter((p) => p.track != null);

  let pool = confirmedPairs.map((p) => p.event);
  let colourOf = new Map(confirmedPairs.map((p) => [p.event.t, p.track!.colour]));
  let source: CrossingSource = "confirmed";
  if (!pool.length && crossings.length) {
    // Quality here is the track's own support, capped to the same 0..10 scale the frame-pair
    // events use, so a caller comparing the two numbers is not misled.
    pool = crossings.map((c) => ({ t: c.t, quality: Math.min(10, c.support), x: c.x, y: c.y, dir: c.dir }));
    colourOf = new Map(crossings.map((c) => [c.t, c.colour]));
    source = "rescued";
  } else if (!pool.length) {
    pool = events;
    colourOf = new Map();
    source = "unconfirmed";
  }

  let picked = pickCrossing(pool, target.centerSec, source === "unconfirmed" ? qualityFloor : 0);
  if (picked && car) picked = colourTiebreak(picked, pool, colourOf, car);
  return {
    ...target,
    detectedSec: picked ? picked.t : null,
    eventCount: pool.length,
    quality: picked ? picked.quality : null,
    source: picked ? source : null,
    rawEventCount: events.length,
    trackCrossingCount: crossings.length,
    // Each candidate carries its own colour: the usual reason a window has more than one is that
    // more than one car went through it, and those are exactly the ones that need telling apart.
    candidates: pool.map((e) => ({ ...e, colour: colourOf.get(e.t) })),
    candidateColours: pool.map((e) => colourOf.get(e.t)),
    colour: picked ? colourOf.get(picked.t) : undefined,
    colourRejected,
  };
}

/**
 * Two candidates this close to each other are "equally near" the prediction, and colour may decide
 * between them. Further apart than this, nearness wins as before — a colour match a second away is
 * a different car, not a better answer.
 */
const COLOUR_TIEBREAK_SEC = 0.35;
/** The alternative has to be clearly closer in colour, not marginally — a swap on noise is a swap. */
const COLOUR_TIEBREAK_MARGIN = 0.7;

/**
 * Among candidates about as near as the chosen one, prefer the one that looks most like the car.
 * The pool is never reduced; this only ever changes which of two near-identical answers is taken.
 */
function colourTiebreak(
  picked: CrossingEvent,
  pool: CrossingEvent[],
  colourOf: Map<number, Rgb | undefined>,
  car: CarColour
): CrossingEvent {
  const dist = (e: CrossingEvent) => {
    const c = colourOf.get(e.t);
    return c ? chromaDistance(chromaOf(c), car.chroma) : null;
  };
  const own = dist(picked);
  if (own == null) return picked;
  let best = picked;
  let bestD = own;
  for (const e of pool) {
    if (e === picked || Math.abs(e.t - picked.t) > COLOUR_TIEBREAK_SEC) continue;
    const d = dist(e);
    if (d != null && d < bestD * COLOUR_TIEBREAK_MARGIN) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** The ROI each line needs decoded, keyed by lineKey. */
export function roisForLines(
  lines: SectorLine[],
  frameW: number,
  frameH: number
): Record<string, Roi> {
  const out: Record<string, Roi> = {};
  for (const line of lines) out[line.lineKey] = roiFor(line, frameW, frameH);
  return out;
}
