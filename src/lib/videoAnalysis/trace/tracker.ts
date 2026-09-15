/**
 * Follow one car through a lap with a window that moves with it.
 *
 * Pixels in, blobs out. Every frame the caller reads a small crop around where the car should
 * be (`windowAt`) and pushes it here; the crop is blurred, differenced against the same patch of
 * a still picture of the empty track (`setBackground`, and the frame before it when there is no
 * such picture), and every moving thing in it is recorded with its position in the full frame. Nothing is decided here: `chain.ts` picks the path afterwards, pinned to the sector
 * crossings. This class only has to keep the window on the car, and say honestly when it cannot.
 *
 * Steering is the nearest blob to where the car was heading. Six frames without one and the
 * tracker is lost: the window widens with every frame the car stays out of sight, is carried
 * along the car's last heading and turn, drawn to the next crossing as that gets near, and it
 * takes four frames of something moving steadily to be followed again. A frame in which most
 * of the window changed is the camera moving, not the car, and is skipped.
 *
 * The heading is read off the last third of a second of sightings, not the last step: a
 * motion blob's centre jitters by a fraction of a car length, and one step of that is no
 * heading at all.
 *
 * DOM-free, so the synthetic scene can drive it and a harness can too.
 */

import { blurFrame, diffWindowBg, dilate5, findBlobs, type Blob } from "../findCrossings/imageOps";
import { patchInto } from "./background";
import type { RowSpans } from "../findCrossings/spans";
import type { FrameCrop, Roi } from "../findCrossings/types";
import type { Rgb } from "../findCrossings/carColour";
import type { Obs, ObsFrame } from "./chain";
import {
  blurKernelForCar,
  fullSpans,
  MAX_LOST_WINDOW_FRAC,
  minAreaForCar,
  windowFor,
  windowSide,
} from "./window";

export type TracerParams = {
  frameW: number;
  frameH: number;
  /** Apparent car length, pixels. */
  carPx: number;
  /** Frame-to-frame channel difference above which a pixel moved. */
  thresh: number;
  /** The recipe's smallest blob at a 20px car; scaled from there. */
  recipeMinArea: number;
  /** Channels of the crops that will be pushed (4 for a canvas readback). */
  channels: number;
  /**
   * The largest car the tracer will be retuned to (`retune`), so the buffers are sized once. The
   * car looks bigger at the near end of the track than the far, and one tracer follows a lap
   * through both.
   */
  maxCarPx?: number;
};

/** Frames without a steering pick before the window widens. */
const LOST_AFTER_FRAMES = 6;
/**
 * A lost window is NOT shrunk when the road says where to look, though it looks as if it could
 * be. Tried on 2026-09-07 at twenty car lengths across: mean coverage fell 92 to 87 %, the holes
 * doubled and the readings lost at the sector lines went 15 to 30 %. The road is read at a share
 * of the stretch's time, and where in a sector a driver brakes moves that a long way along the
 * track even when the sector times match — so it is a good place to point a wide window and a
 * bad place to put a narrow one.
 */

/** Steady sightings needed to be followed again. */
const REACQUIRE_FRAMES = 4;
/**
 * How far what is being followed may sit from where the road says the car is, in car lengths,
 * and for how many frames, before it is let go.
 *
 * The road is only consulted when the car is out of sight, which does nothing for the worse
 * failure: following something that is not the car at all. At the Bendigo start line one lap
 * spent its whole first sector on a flickering patch of the drivers' stand a car length off the
 * road, never lost, never doubted, and drew twenty-seven points of it (2026-09-07).
 *
 * The road is read at this lap's own share of this lap's own sector, so a driver simply going
 * slower is already accounted for; what is left is where in the sector the braking happens, a
 * tenth of it at most. Six car lengths is well past that and well short of the eight and more
 * that a thing standing still runs up by the end of a sector. It has to hold for half a dozen
 * frames, so one bad blob does not throw a good chain away.
 *
 * Only where both crossings of the stretch were found in the footage. Where one was not, the
 * share of the stretch is a guess and so is the road position: a 4K lap whose two unlocated
 * crossings bracketed half of it lost two thirds of its frames to this rule before that was
 * spelt out (2026-09-07).
 */
const HINT_DISAGREE_CAR_LENGTHS = 6;
const HINT_DISAGREE_FRAMES = 6;
/**
 * And how far they must have travelled, in car lengths, before they are believed to be a car.
 *
 * A widened window catches whatever else differs from the empty track — a parked car, a
 * marshal, a driver's stand — and four sightings of something standing perfectly still are the
 * steadiest thing there is, so the old test welcomed them. Measured on the Bendigo fisheye,
 * 2026-09-07: losing the car at the start line, the window latched onto a fixed point six
 * hundred pixels away, sat on it for a second and a quarter, and the whole sector was read off
 * it. The one thing a car on a lap never does is stay where it is.
 */
const REACQUIRE_TRAVEL_CAR_LENGTHS = 1;
/** How long the last heading (and turn) is carried once the car is lost. */
const DEAD_RECKON_SEC = 1.0;
/** Within this long of the next crossing, a lost window is drawn towards it. */
const AIM_BLEND_SEC = 0.5;
/**
 * How hard a lost window is drawn towards the next crossing, as a power of how far through the
 * wait it is. The car was last seen somewhere and must be at that crossing at a known moment, so
 * anywhere in between is a blend of the two. Squared rather than straight: just after losing
 * sight the heading is still the better guess, and the crossing only takes over as it nears.
 *
 * It used to be a straight blend over the last half second and dead reckoning before that, which
 * on a long stretch left the window frozen where a one-second-old heading put it — on the
 * Bendigo fisheye that parked it seven hundred pixels off the road for most of a sector while
 * the car went by unseen (2026-09-07).
 */
const AIM_BLEND_POWER = 2;
/** Sightings this far back inform the heading. */
const HISTORY_SEC = 0.3;
/** More of the window than this moving is the camera, not a car. */
const SHAKE_FRACTION = 0.35;
/** More blobs than this in a following window is the camera too; a lost window is wider. */
const SHAKE_BLOBS = 8;
/**
 * When the camera moves, every edge in the window moves with it, so the motion arrives as many
 * blobs of similar size. When a car moves, one thing moves. This is the share of the moving mass
 * the two biggest blobs must hold for the frame to be read as a car rather than a shake — a car
 * and the sliver it left behind are two blobs, which is why it is the top two and not the top one.
 */
const SHAKE_TOP_SHARE = 0.6;
/**
 * And how much of the window that thing may fill. When the ground moves, every edge in the window
 * moves at once and dilation welds the lot into one blob the size of the window — which the share
 * test alone reads as a single object. Measured against the window and not against the car on
 * purpose: the car's size is only known from frames that were kept, so keying this to it deadlocks
 * exactly where it is needed (a 4K sector by the start line, 2026-09-07: the guard threw the car
 * away, so its size never grew, so the guard kept throwing it away).
 */
const SHAKE_BLOB_WINDOW_SHARE = 0.6;
/** Car lengths per second a car may cover: the same bar `tracks.ts` sets. */
const MAX_SPEED_CAR_LENGTHS_PER_SEC = 45;
/** Car lengths per second squared a car may gain: a touring car leaving a hairpin, flat out. */
const MAX_ACCEL_CAR_LENGTHS_PER_SEC2 = 45;
/** Half-width of the patch averaged for a blob's colour. */
const COLOUR_PATCH = 5;
/** Steering only takes a blob whose area is within this factor of the car's usual. */
const AREA_RATIO = 4;
/**
 * How many followed blobs the car's size is read from, and how much of a motion blob's box is
 * car: the box spans where the car was and where it is, so it runs a step long.
 */
const SIZE_HISTORY = 10;
const SIZE_FROM_BOX = 0.8;
/** No car is believed bigger than this share of the frame width. */
const MAX_CAR_FRAC = 0.15;
/**
 * The largest blobs of a frame are the ones kept; the rest are kerb flicker and grain. A lost
 * window half the frame wide sees dozens, and every one of them is a node the chain must weigh.
 */
const MAX_BLOBS_PER_FRAME = 8;
const AREA_HISTORY = 15;

export type Sighting = { t: number; x: number; y: number };

type Motion = { vx: number; vy: number; turn: number };

/** Heading and turn from a run of sightings: the oldest within reach against the newest. */
function motionOf(history: Sighting[]): Motion {
  const n = history.length;
  if (n < 2) return { vx: 0, vy: 0, turn: 0 };
  const a = history[0]!;
  const b = history[n - 1]!;
  const span = b.t - a.t;
  if (span <= 0) return { vx: 0, vy: 0, turn: 0 };
  const vx = (b.x - a.x) / span;
  const vy = (b.y - a.y) / span;
  if (n < 4) return { vx, vy, turn: 0 };
  // Turn: the heading over the second half against the first.
  const m = history[n >> 1]!;
  const d1 = m.t - a.t;
  const d2 = b.t - m.t;
  if (d1 <= 0 || d2 <= 0) return { vx, vy, turn: 0 };
  const h1 = Math.atan2(m.y - a.y, m.x - a.x);
  const h2 = Math.atan2(b.y - m.y, b.x - m.x);
  let dh = h2 - h1;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return { vx, vy, turn: dh / ((d1 + d2) / 2) };
}

export class LapTracer {
  /** Everything seen, frame by frame, in full-frame pixels. */
  readonly frames: ObsFrame[] = [];
  /** Frames skipped as camera movement. */
  shakeFrames = 0;
  /** Video times of those frames, so a sector can say how many of its own were lost that way. */
  readonly shookAt: number[] = [];
  readFrames = 0;
  /** Pixels that moved in the last frame pushed, for the log. */
  lastMoved = 0;
  /** The car's apparent size as each frame was read, so a stretch can be told how big it was. */
  readonly sizeAtT: Array<{ t: number; px: number }> = [];

  /** The size in use: measured from the car when it has been seen, the caller's guess until then. */
  private carPx: number;
  private guessCarPx: number;
  private thresh: number;
  private kernel: 1 | 3 | 5;
  private minArea: number;
  private readonly maxCarPx: number;
  /** Longest side of the last few followed blobs, pixels. */
  private sizes: number[] = [];
  private readonly bufs: [Uint8Array, Uint8Array];
  private readonly horiz: Int32Array;
  private readonly motion: Uint8Array;
  private readonly dilBuf: { a: Uint8Array; b: Uint8Array; horiz: Uint8Array };
  private readonly seen: Uint8Array;
  private readonly stack: Int32Array;
  private readonly spansBySize = new Map<number, RowSpans>();

  private cur = 0;
  private prev: { roi: Roi; width: number; height: number } | null = null;
  /** The empty track, full frame, when the caller could build one. */
  private background: FrameCrop | null = null;
  /** Room for the patch of it under the window, and that patch blurred. Made on first use. */
  private bgRaw: Uint8Array | null = null;
  private bgBlur: Uint8Array | null = null;

  /** Sightings while following, oldest first, within `HISTORY_SEC` of the newest. */
  private history: Sighting[] = [];
  private lostFrames = 0;
  /** Frames running in which what is followed has disagreed with the road. */
  private offRoad = 0;
  /** The next frame is read only to become the reference; see the shake note in `push`. */
  private skipNext = false;
  /** The chain being watched while lost, oldest first. */
  private tentative: Sighting[] = [];
  private areas: number[] = [];

  constructor(private readonly p: TracerParams) {
    this.carPx = p.carPx;
    this.guessCarPx = p.carPx;
    this.thresh = p.thresh;
    this.maxCarPx = Math.max(p.carPx, p.maxCarPx ?? p.carPx, Math.round(p.frameW * MAX_CAR_FRAC));
    this.kernel = blurKernelForCar(p.carPx);
    this.minArea = minAreaForCar(p.carPx, p.recipeMinArea);
    // Sized once, as wide as a lost window may grow (`windowAt`), not just as wide as it starts.
    const maxSide = Math.max(
      windowSide(this.maxCarPx, p.frameW, true),
      Math.round(Math.min(p.frameW, p.frameH, p.frameW * MAX_LOST_WINDOW_FRAC))
    );
    const px = maxSide * maxSide;
    const bytes = px * p.channels;
    this.bufs = [new Uint8Array(bytes), new Uint8Array(bytes)];
    this.horiz = new Int32Array(bytes);
    this.motion = new Uint8Array(px);
    this.dilBuf = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
    this.seen = new Uint8Array(px);
    this.stack = new Int32Array(px);
  }

  /**
   * The caller's guess at the car's apparent size here. Used until the car has been followed
   * for a few frames; from then on the blobs themselves say how big it is, which on a fisheye
   * is the only thing that does — the lines are all at the far end, and a car passing under the
   * camera between two of them is ten times the size either line suggests (Bendigo, 2026-09-06).
   */
  retune(carPx: number): void {
    this.guessCarPx = carPx;
    this.applySize();
  }

  /** What the car looks like now, for the log. */
  get carSizePx(): number {
    return this.carPx;
  }

  /** The motion gate from here on — each stretch of track is read at its own lines' gate. */
  setThresh(thresh: number): void {
    this.thresh = thresh;
  }

  /**
   * A still picture of the empty track, the same size as the frames being read. Given one, every
   * frame is differenced against it rather than against the frame before, which shows the car
   * whole instead of the sliver it moved into and makes the first frame of a stretch usable.
   * Null goes back to differencing frame against frame.
   */
  setBackground(bg: FrameCrop | null): void {
    if (bg && (bg.width !== this.p.frameW || bg.height !== this.p.frameH || bg.channels !== this.p.channels)) {
      throw new Error("The still picture must match the frames being read.");
    }
    this.background = bg;
    if (bg && !this.bgRaw) {
      const bytes = this.bufs[0]!.length;
      this.bgRaw = new Uint8Array(bytes);
      this.bgBlur = new Uint8Array(bytes);
    }
  }

  /** Whether a still picture is in use, for the log. */
  get hasBackground(): boolean {
    return this.background != null;
  }

  private applySize(): void {
    let px = this.guessCarPx;
    if (this.sizes.length >= 3) {
      const sorted = [...this.sizes].sort((a, b) => a - b);
      px = sorted[sorted.length >> 1]! * SIZE_FROM_BOX;
    }
    this.carPx = Math.min(this.maxCarPx, Math.max(1, px));
    this.kernel = blurKernelForCar(this.carPx);
    this.minArea = minAreaForCar(this.carPx, this.p.recipeMinArea);
  }

  private noteSize(o: Obs): void {
    this.sizes.push(Math.max(o.w, o.h));
    if (this.sizes.length > SIZE_HISTORY) this.sizes.shift();
    this.applySize();
  }

  /**
   * Start from a known position: the crossing the stretch begins at. `sizePx` is the car's
   * apparent length there when the crossing scan saw it, and resets what the tracer believes.
   */
  seed(x: number, y: number, t: number, sizePx?: number): void {
    this.history = [{ t, x, y }];
    this.lostFrames = 0;
    this.tentative = [];
    if (sizePx != null && sizePx > 0) {
      this.sizes = [sizePx, sizePx, sizePx];
      this.applySize();
    }
  }

  get lost(): boolean {
    return this.history.length === 0 || this.lostFrames >= LOST_AFTER_FRAMES;
  }

  /** Where the car was last seen. */
  get lastSeen(): Sighting | null {
    return this.history.length ? this.history[this.history.length - 1]! : null;
  }

  /**
   * Where the track goes at this moment, when laps already followed can say (`road.ts`). Used
   * only while the car is out of sight, and only to point the window.
   */
  private hint: { x: number; y: number; sure: boolean } | null = null;

  /**
   * Told, before each frame, where the track runs at that moment. Null when nothing knows.
   *
   * `sure` is whether the two crossings this stretch runs between were both found in the footage.
   * The road is read at a share of the stretch's time, so a crossing the scan could only put a
   * time to — never a place — makes that share a guess, and a guessed share is fine for pointing
   * a wide window and no use at all for judging what is already being followed.
   */
  setHint(hint: { x: number; y: number; sure: boolean } | null): void {
    this.hint = hint;
  }

  /**
   * Where the car should be at `t`. Following: the last sighting carried along its heading.
   * Lost: the same along an arc at the last turn rate, drawn to the next crossing as that
   * crossing gets near in time. The heading alone is wrong round a bend; the crossing alone is
   * wrong until the car is nearly there; between them the widened window stays on the car.
   */
  private predict(t: number, aim: Sighting | null): { x: number; y: number } | null {
    const last = this.lastSeen;
    if (!last) return aim ? { x: aim.x, y: aim.y } : null;
    const m = motionOf(this.history);
    const since = t - last.t;
    if (!this.lost) return { x: last.x + m.vx * since, y: last.y + m.vy * since };
    // The road, when a lap that was followed knows where it goes here, beats carrying a stale
    // heading: the car is on the track, and the track is where it was last time round.
    if (this.hint) {
      const near = Math.min(since, DEAD_RECKON_SEC) / DEAD_RECKON_SEC;
      const f = Math.min(1, near);
      const h = this.hint;
      if (aim && aim.t > t && aim.t - t < AIM_BLEND_SEC) {
        const left = (aim.t - t) / AIM_BLEND_SEC;
        return { x: h.x + (aim.x - h.x) * (1 - left), y: h.y + (aim.y - h.y) * (1 - left) };
      }
      return { x: last.x + (h.x - last.x) * f, y: last.y + (h.y - last.y) * f };
    }
    const carried = Math.min(since, DEAD_RECKON_SEC);
    let dr: { x: number; y: number };
    if (Math.abs(m.turn) > 1e-3) {
      const sn = Math.sin(m.turn * carried);
      const cs = Math.cos(m.turn * carried);
      dr = {
        x: last.x + (m.vx * sn + m.vy * (cs - 1)) / m.turn,
        y: last.y + (m.vx * (1 - cs) + m.vy * sn) / m.turn,
      };
    } else {
      dr = { x: last.x + m.vx * carried, y: last.y + m.vy * carried };
    }
    if (aim && aim.t > t) {
      const left = aim.t - t;
      if (left < 0.5) {
        const f = 1 - left / 0.5;
        return { x: dr.x + (aim.x - dr.x) * f, y: dr.y + (aim.y - dr.y) * f };
      }
    }
    return dr;
  }

  /** The window to read for the frame at `t`. `aim` is the next crossing, used only when lost. */
  windowAt(t: number, aim: Sighting | null): Roi {
    const p = this.predict(t, aim) ?? aim ?? { x: this.p.frameW / 2, y: this.p.frameH / 2 };
    let side = windowSide(this.carPx, this.p.frameW, this.lost);
    const last = this.lastSeen;
    if (this.lost && last) {
      // The longer the car has been out of sight, the further it could have got: at the speed it
      // was doing, plus whatever it could have gained flat out since — a car hidden on a corner
      // exit comes back out much quicker than it went in.
      const m = motionOf(this.history);
      const since = t - last.t;
      const gained = 0.5 * MAX_ACCEL_CAR_LENGTHS_PER_SEC2 * this.carPx * since * since;
      const reach = 2 * (Math.hypot(m.vx, m.vy) * since + gained);
      side = Math.round(Math.min(this.p.frameW * MAX_LOST_WINDOW_FRAC, Math.max(side, reach)));
    }
    return windowFor(p.x, p.y, side, this.p.frameW, this.p.frameH);
  }

  private spansFor(w: number, h: number): RowSpans {
    const key = w * 65536 + h;
    let s = this.spansBySize.get(key);
    if (!s) {
      s = fullSpans(w, h);
      this.spansBySize.set(key, s);
    }
    return s;
  }

  /**
   * One frame. `crop` is the window's pixels the motion is read on — colour, or brightness
   * alone when the calibration says so (its buffer may be reused by the caller once this
   * returns); `roi` where it was cut from; `t` the frame's own time. `colourCrop` is the same
   * window in colour, for what colour each moving thing is, when `crop` is not.
   */
  push(crop: FrameCrop, roi: Roi, t: number, aim: Sighting | null = null, colourCrop?: FrameCrop): void {
    this.readFrames++;
    this.sizeAtT.push({ t, px: this.carPx });
    const w = crop.width;
    const h = crop.height;
    const spans = this.spansFor(w, h);
    const curIdx = this.cur;
    const prevIdx = 1 - curIdx;
    this.cur = prevIdx;
    const blurred = blurFrame(crop, this.kernel, spans, spans, {
      horiz: this.horiz,
      out: this.bufs[curIdx]!,
    });

    const prev = this.prev;
    this.prev = { roi, width: w, height: h };
    if (!prev && !this.background) {
      this.frames.push({ t, blobs: [] });
      return;
    }
    // The same ground as the window, cut from the empty track and blurred the same way, so the
    // two pictures differ only by what is actually on the track.
    const bgPatch = this.background
      ? blurFrame(patchInto(this.background, roi, this.bgRaw!), this.kernel, spans, spans, {
          horiz: this.horiz,
          out: this.bgBlur!,
        })
      : null;
    const prevCrop: FrameCrop | null = prev
      ? { width: prev.width, height: prev.height, channels: crop.channels, data: this.bufs[prevIdx]! }
      : null;
    // The blur reflects at each crop's own edge, so two crops cut from different places disagree
    // in a rim as wide as the kernel; that rim is left out of the comparison.
    const moved = diffWindowBg(
      prevCrop,
      prev?.roi ?? null,
      bgPatch,
      blurred,
      roi,
      this.thresh,
      this.motion,
      this.kernel >> 1
    );
    this.lastMoved = moved;
    if (this.skipNext) {
      this.skipNext = false;
      this.shakeFrames++;
      this.shookAt.push(t);
      this.frames.push({ t, blobs: [] });
      this.noPick();
      return;
    }
    const grown = dilate5(this.motion, w, h, [spans, spans], this.dilBuf);
    const blobs = findBlobs(grown, w, h, this.minArea, spans, this.seen, this.stack);

    const wasLost = this.lost;
    if (this.cameraMoved(moved, w * h, blobs, wasLost)) {
      this.shakeFrames++;
      this.shookAt.push(t);
      this.frames.push({ t, blobs: [] });
      // One displaced frame spoils the difference on BOTH sides of it — against the frame
      // before and against the frame after — and which of the two the guard notices is a coin
      // toss. So the neighbours go with it: the frame already recorded loses its blobs, and the
      // next one is read only to be the reference for the one after. Three frames, a tenth of a
      // second, against something that on real footage never happens at all (the camera was
      // measured at 0.00–0.01 px a frame on every graded clip). Without it, the frame the guard
      // missed came back with the car welded to the shifted ground and its middle a car length
      // off the truth, and the chain drew it.
      //
      // Reaching back to the last good frame instead is worse than dropping them: a difference
      // spans where the car was and where it is, so a step of two frames puts the blob's middle
      // twice as far behind the car (measured 1.73 car lengths against 0.96).
      const before = this.frames[this.frames.length - 2];
      if (before && before.blobs.length) {
        before.blobs = [];
        this.shakeFrames++;
        this.shookAt.push(before.t);
      }
      this.skipNext = true;
      this.noPick();
      return;
    }

    const obs: Obs[] = [];
    const kept = blobs.length > MAX_BLOBS_PER_FRAME ? [...blobs].sort((a, b) => b.area - a.area).slice(0, MAX_BLOBS_PER_FRAME) : blobs;
    for (const b of kept) {
      if (!Number.isFinite(b.cx) || !Number.isFinite(b.cy)) continue;
      obs.push({
        t,
        x: roi.x0 + b.cx,
        y: roi.y0 + b.cy,
        w: b.box.x1 - b.box.x0 + 1,
        h: b.box.y1 - b.box.y0 + 1,
        area: b.area,
        colour: meanColour(colourCrop ?? crop, b),
      });
    }
    this.frames.push({ t, blobs: obs });
    this.steer(obs, t, aim, wasLost);
  }

  /**
   * Is this frame the camera moving rather than a car?
   *
   * Against the frame before, only things that moved show up, so the camera gives itself away by
   * HOW MANY things move at once: every edge in the scene arrives as its own blob, none of them
   * owning the movement. A car close to the lens fills the window and breaks in two — where it
   * was and where it now is — which counting alone read as a shake, and cost one 4K sector 50 of
   * its 65 frames (measured 2026-09-07), hence the share test rather than a count.
   *
   * Against a still picture of the empty track none of that reasoning survives. Everything that
   * is not track differs from it — parked cars, marshals, the crowd, and grain — so a perfectly
   * steady frame hands over hundreds of blobs, no one of which owns anything: measured on the
   * Bendigo fisheye, 2026-09-07, a median of 181 blobs in the far sector on frames where the
   * share of the window that differed never passed 14 %. Counting there rejected 211 frames of
   * one lap and emptied three sectors. So with a still picture the only test left is the honest
   * one — a camera that moves lights up the WHOLE window, because every edge in it has moved.
   */
  private cameraMoved(
    moved: number,
    windowPx: number,
    blobs: ReadonlyArray<{ area: number }>,
    wasLost: boolean
  ): boolean {
    const busy = moved > SHAKE_FRACTION * windowPx;
    if (this.background) return busy;
    if (!busy && blobs.length <= SHAKE_BLOBS * (wasLost ? 4 : 1)) return false;
    let first = 0;
    let second = 0;
    let total = 0;
    for (const b of blobs) {
      total += b.area;
      if (b.area > first) {
        second = first;
        first = b.area;
      } else if (b.area > second) second = b.area;
    }
    if (total <= 0) return true;
    if (first > SHAKE_BLOB_WINDOW_SHARE * windowPx) return true;
    return (first + second) / total < SHAKE_TOP_SHARE;
  }

  private noPick(): void {
    this.lostFrames++;
    if (this.lost) this.tentative = [];
  }

  /** Keep the window on the car: the nearest plausible blob to where it was heading. */
  private steer(obs: Obs[], t: number, aim: Sighting | null, wasLost: boolean): void {
    let pred = this.predict(t, aim);
    if (wasLost && this.tentative.length) {
      // A chain being watched is judged against itself, not the dead reckoning that found it.
      const m = motionOf(this.tentative);
      const tl = this.tentative[this.tentative.length - 1]!;
      pred = { x: tl.x + m.vx * (t - tl.t), y: tl.y + m.vy * (t - tl.t) };
    }
    if (!pred) {
      // Never seeded: the first thing seen is followed.
      const first = obs[0];
      if (first) this.follow(first, t);
      return;
    }
    const tent = this.tentative.length ? this.tentative[this.tentative.length - 1]! : null;
    const ref = wasLost && tent ? tent : this.lastSeen;
    const dt = ref ? Math.max(1 / 120, t - ref.t) : 1 / 30;
    const maxSpeed = MAX_SPEED_CAR_LENGTHS_PER_SEC * this.carPx;
    const reach = Math.max(2 * this.carPx, maxSpeed * dt);
    const medianArea = this.medianArea();
    let pick: Obs | null = null;
    let pickD = Infinity;
    for (const o of obs) {
      if (medianArea != null && (o.area > medianArea * AREA_RATIO || o.area < medianArea / AREA_RATIO)) {
        continue;
      }
      const d = Math.hypot(o.x - pred.x, o.y - pred.y);
      if (d > reach) continue;
      if (d < pickD) {
        pickD = d;
        pick = o;
      }
    }
    if (!pick) {
      this.noPick();
      return;
    }
    if (!wasLost) {
      this.follow(pick, t);
      return;
    }
    // Lost: it takes a few steady sightings to be believed again.
    const steady =
      tent != null &&
      Math.hypot(pick.x - tent.x, pick.y - tent.y) <= maxSpeed * Math.max(1 / 120, t - tent.t);
    if (!steady) this.tentative = [];
    this.tentative.push({ t, x: pick.x, y: pick.y });
    const head = this.tentative[0]!;
    const went = Math.hypot(pick.x - head.x, pick.y - head.y);
    if (this.tentative.length >= REACQUIRE_FRAMES && went >= REACQUIRE_TRAVEL_CAR_LENGTHS * this.carPx) {
      this.history = this.tentative;
      this.tentative = [];
      this.lostFrames = 0;
      this.pushArea(pick.area);
      this.noteSize(pick);
      return;
    }
    // A chain that has run long enough to be a car and still gone nowhere is not one; drop its
    // oldest sighting so it can never accumulate into a reacquisition.
    if (this.tentative.length > REACQUIRE_FRAMES * 2) this.tentative.shift();
  }

  private follow(o: Obs, t: number): void {
    if (this.hint?.sure && Math.hypot(o.x - this.hint.x, o.y - this.hint.y) > HINT_DISAGREE_CAR_LENGTHS * this.carPx) {
      this.offRoad++;
      if (this.offRoad >= HINT_DISAGREE_FRAMES) {
        // Let it go. Six frames without a pick makes the window widen and take the road's word
        // for where to look, which is the whole point of having one.
        this.history = [];
        this.offRoad = 0;
        this.noPick();
        return;
      }
    } else {
      this.offRoad = 0;
    }
    this.history.push({ t, x: o.x, y: o.y });
    while (this.history.length > 2 && this.history[0]!.t < t - HISTORY_SEC) this.history.shift();
    this.lostFrames = 0;
    this.pushArea(o.area);
    this.noteSize(o);
  }

  private pushArea(a: number): void {
    this.areas.push(a);
    if (this.areas.length > AREA_HISTORY) this.areas.shift();
  }

  private medianArea(): number | null {
    if (this.areas.length < 5) return null;
    const s = [...this.areas].sort((a, b) => a - b);
    return s[s.length >> 1]!;
  }
}

/** Mean colour of a small patch at the blob's centre, from the unblurred crop. */
function meanColour(crop: FrameCrop, b: Blob): Rgb | undefined {
  if (crop.channels < 3) return undefined;
  const { width: w, height: h, channels: c, data } = crop;
  const cx = Math.round(b.cx);
  const cy = Math.round(b.cy);
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  for (let y = Math.max(0, cy - COLOUR_PATCH); y <= Math.min(h - 1, cy + COLOUR_PATCH); y++) {
    for (let x = Math.max(0, cx - COLOUR_PATCH); x <= Math.min(w - 1, cx + COLOUR_PATCH); x++) {
      const i = (y * w + x) * c;
      r += data[i]!;
      g += data[i + 1]!;
      bl += data[i + 2]!;
      n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: bl / n } : undefined;
}
