"use client";

/**
 * Trace one lap in the browser: the file read once, a small window following the car.
 *
 * The frames come the way the crossing scan gets them (`frameSource.ts`: decoded straight out of
 * the file when the browser can, the player otherwise). Per frame one small rectangle is drawn
 * from the frame and read back, never the whole picture: a full 4K readback is the cost that
 * made a browser detector impossible (93.8ms a frame, measured in `browserScan.ts`), and the
 * window is a few car lengths across.
 *
 * Before the lap is read, the crossings without a stored position (the start line, a hand mark)
 * are seeded by running the crossing detector on that line for half a second either side of the
 * known time. Then the lap is read in one pass, the tracer records every moving thing in its
 * window, and `chain.ts` picks the path sector by sector between the pinned crossings.
 */

import { calibrateFromFrames, thresholdFor, type ChannelMode, type LineCalibration } from "../findCrossings/calibrate";
import { WindowScanner, resultFromWindow } from "../findCrossings/detector";
import { bandMask, blurKernelForLine, lineGeom, roiFor, type LineGeom } from "../findCrossings/geometry";
import { spansFromMask } from "../findCrossings/spans";
import {
  checkAbort,
  openFrameSource,
  type FrameImage,
  type FrameSource,
  type FrameSourceKind,
} from "../findCrossings/frameSource";
import type { CarColour } from "../findCrossings/carColour";
import { ACTIVE_RECIPE, type FrameCrop, type Roi, type SectorLine } from "../findCrossings/types";
import type { DriverRole, ManualLapTrace } from "@/lib/manualVideoAnalysis/types";
import type { LapAnchor } from "./anchors";
import { chainThrough, defaultChainParams, type ChainAnchor, type ChainResult, type ObsFrame } from "./chain";
import { stitchTrace } from "./stitch";
import { LapTracer, type Sighting } from "./tracker";
import { BACKGROUND_FRAMES, medianBackground } from "./background";
import { roadFrom, type Road } from "./road";
import { carPxBetween, MAX_LOST_WINDOW_FRAC, MIN_CAR_PX } from "./window";

/** See the note on `READ_FREQUENTLY` in `browserScan.ts`: the hint is a trap on video sources. */
const READ_FREQUENTLY = false;
/** Rec.709, as `browserScan.ts` recovers brightness from RGBA. */
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
/** Either side of a known crossing time to look for the car at the line. */
const SEED_HALF_SEC = 0.35;
/** A detected crossing further from the known time than this is another car. */
const SEED_AGREE_SEC = 0.12;
/** Margin read either side of the lap so the first and last frames have a previous one. */
const LAP_MARGIN_SEC = 0.1;

export type TraceProgress = { fraction: number; note: string };

/**
 * Everything a lap's path was chosen from, handed out for a harness to choose it again.
 *
 * Reading a lap costs a browser, a file and eight seconds; choosing the path from what was read
 * costs nothing. So a page that sets `__traceDump` to an array is given the raw sightings, and a
 * script can then try a different way of picking the path over the whole grading set in a second
 * rather than an hour. Inert unless something sets it, which only a dev script does.
 */
export type TraceDump = {
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  frame: { w: number; h: number };
  startSec: number;
  endSec: number;
  /** Every crossing of the lap in time order, position where one is known. */
  anchors: Array<{ lineKey: string; t: number; x: number | null; y: number | null }>;
  /** Every moving thing in every frame read. */
  frames: ObsFrame[];
  /** How big the car looked as each frame was read. */
  sizeAtT: Array<{ t: number; px: number }>;
  /** Frames thrown out as the camera moving. */
  shookAt: number[];
  /** The car's apparent length at each crossing, keyed by its time. */
  carPxAtAnchor: Array<[number, number]>;
  /** The car's apparent length each stretch was chained at, in the order the stretches ran. */
  chainCarPx: number[];
  car: CarColour | null;
  starved: boolean;
};

export type TraceLapOptions = {
  video: HTMLVideoElement;
  file?: Blob | null;
  frameW: number;
  frameH: number;
  lines: SectorLine[];
  anchors: LapAnchor[];
  startSec: number;
  endSec: number;
  sessionId: string;
  driverRole: DriverRole;
  lapNumber: number;
  /** The driver's paint, when the scan learnt it. */
  car?: CarColour | null;
  /**
   * Laps of this video already traced — any driver's. Where one of them followed a stretch
   * cleanly it says where the track goes there, which is where a lost window should look.
   */
  priors?: ManualLapTrace[];
  /**
   * Frame-to-frame difference above which a pixel moved. Measured per line, the way the crossing
   * scan measures every line (`calibrate.ts`), and each stretch of track is read at the gentler
   * of its two lines' gates; a number here overrides all of that.
   */
  thresh?: number;
  onProgress?: (p: TraceProgress) => void;
  signal?: AbortSignal;
};

export type TraceLapOutcome = {
  trace: ManualLapTrace;
  reader: FrameSourceKind;
  /** How the footage was read: which channel, and each line's gate on it. */
  calibration: { mode: ChannelMode; byLine: Record<string, number> } | null;
  elapsedMs: number;
  framesRead: number;
  /** Which crossings were seeded off the footage, and which could not be. */
  seeded: Array<{ lineKey: string; t: number; found: boolean }>;
};

/**
 * One canvas, sized for the biggest rectangle that will be asked of it, reading any smaller one.
 * The readback allocates its own bytes; there is no cheaper way to get pixels off a video frame.
 */
class CropReader {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lumaBuf: Uint8Array;
  drawMs = 0;
  readMs = 0;

  constructor(maxW: number, maxH: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = maxW;
    this.canvas.height = maxH;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: READ_FREQUENTLY });
    if (!ctx) throw new Error("Could not open a 2D canvas to read the video.");
    this.ctx = ctx;
    this.lumaBuf = new Uint8Array(maxW * maxH);
  }

  /** Brightness alone, Rec.709 weights, into a buffer reused every call — see `browserScan.ts`. */
  toLuma(crop: FrameCrop): FrameCrop {
    const { width, height, channels: c, data } = crop;
    const out = this.lumaBuf;
    for (let p = 0, i = 0; p < width * height; p++, i += c) {
      out[p] = (data[i]! * LUMA_WEIGHTS[0] + data[i + 1]! * LUMA_WEIGHTS[1] + data[i + 2]! * LUMA_WEIGHTS[2] + 0.5) | 0;
    }
    return { width, height, channels: 1, data: out };
  }

  read(image: FrameImage, roi: Roi): FrameCrop {
    const w = roi.x1 - roi.x0;
    const h = roi.y1 - roi.y0;
    const t0 = performance.now();
    this.ctx.drawImage(image, roi.x0, roi.y0, w, h, 0, 0, w, h);
    const t1 = performance.now();
    const img = this.ctx.getImageData(0, 0, w, h);
    this.drawMs += t1 - t0;
    this.readMs += performance.now() - t1;
    return { width: w, height: h, channels: 4, data: new Uint8Array(img.data.buffer) };
  }
}

/**
 * A still picture of the empty track, from frames spread across the lap.
 *
 * One extra pass over the same stretch of video, keeping `BACKGROUND_FRAMES` whole frames as far
 * apart in time as the lap allows, and taking the middle value of every pixel. Whole frames, not
 * the little windows the tracer reads, because the window is somewhere different every frame and
 * the picture has to cover wherever it goes. The cost is one more decode of the lap, a couple of
 * seconds; what it buys is the car seen whole in every frame instead of the sliver it moved into.
 */
async function emptyTrack(
  source: FrameSource,
  frameW: number,
  frameH: number,
  luma: boolean,
  fromSec: number,
  toSec: number,
  signal: AbortSignal | undefined
): Promise<FrameCrop | null> {
  const canvas = document.createElement("canvas");
  canvas.width = frameW;
  canvas.height = frameH;
  const ctx = canvas.getContext("2d", { willReadFrequently: READ_FREQUENTLY });
  if (!ctx) return null;
  const want: number[] = [];
  for (let k = 0; k < BACKGROUND_FRAMES; k++) {
    want.push(fromSec + ((toSec - fromSec) * k) / (BACKGROUND_FRAMES - 1));
  }
  const got: FrameCrop[] = [];
  let next = 0;
  await source.readRange(
    fromSec,
    toSec,
    1,
    (image, t) => {
      if (next >= want.length || t < want[next]!) return;
      next++;
      ctx.drawImage(image, 0, 0, frameW, frameH);
      const rgba = new Uint8Array(ctx.getImageData(0, 0, frameW, frameH).data.buffer);
      if (!luma) {
        got.push({ width: frameW, height: frameH, channels: 4, data: rgba });
        return;
      }
      const grey = new Uint8Array(frameW * frameH);
      for (let q = 0, i = 0; q < grey.length; q++, i += 4) {
        grey[q] =
          (rgba[i]! * LUMA_WEIGHTS[0] + rgba[i + 1]! * LUMA_WEIGHTS[1] + rgba[i + 2]! * LUMA_WEIGHTS[2] + 0.5) | 0;
      }
      got.push({ width: frameW, height: frameH, channels: 1, data: grey });
    },
    signal
  );
  return medianBackground(got);
}

/**
 * Where the car was on a line at a known moment: the crossing detector, run over a short
 * stretch around it. Null when nothing crossed there then.
 */
async function seedAtLine(
  source: FrameSource,
  reader: CropReader,
  line: SectorLine,
  t: number,
  frameW: number,
  frameH: number,
  car: CarColour | null | undefined,
  signal: AbortSignal | undefined,
  cal: LineCalibration | null,
  /** When given, every frame read is kept here, so the band can be calibrated on them after. */
  keep?: { colour: FrameCrop[]; luma: FrameCrop[] }
): Promise<{ x: number; y: number; t: number; sizePx: number | null } | null> {
  const roi = roiFor(line, frameW, frameH);
  const luma = cal?.mode === "luma";
  const scanner = new WindowScanner(
    line,
    roi,
    frameW,
    frameH,
    { ...ACTIVE_RECIPE, thresh: cal?.thresh ?? ACTIVE_RECIPE.thresh },
    luma ? 1 : 4
  );
  await source.readRange(
    Math.max(0, t - SEED_HALF_SEC),
    t + SEED_HALF_SEC,
    1,
    (image, ft) => {
      const crop = reader.read(image, roi);
      const bright = reader.toLuma(crop);
      if (keep) {
        keep.colour.push(crop);
        keep.luma.push({ ...bright, data: new Uint8Array(bright.data.subarray(0, bright.width * bright.height)) });
      }
      scanner.push(luma ? bright : crop, ft, crop);
    },
    signal
  );
  const r = resultFromWindow(
    { id: `seed:${line.lineKey}`, lineKey: line.lineKey, lapNumber: 0, centerSec: t, truthSec: t },
    scanner.samples,
    scanner.frames,
    scanner.trackerConfig,
    { car: car ?? null, bounds: scanner.bounds }
  );
  // How big the thing that crossed looked: the blob nearest the crossing in the frame nearest
  // its moment. A motion blob of a car of length L and width L/2 covers about L²/2, plus a step.
  const sizeNear = (x: number, y: number, at: number): number | null => {
    let frame = scanner.frames[0];
    for (const f of scanner.frames) if (!frame || Math.abs(f.t - at) < Math.abs(frame.t - at)) frame = f;
    if (!frame) return null;
    let blob = frame.blobs[0];
    for (const b of frame.blobs) if (!blob || Math.hypot(b.x - x, b.y - y) < Math.hypot(blob.x - x, blob.y - y)) blob = b;
    return blob && blob.area > 0 ? Math.sqrt(2 * blob.area) : null;
  };
  const picked = r.detectedSec != null ? r.candidates.find((c) => Math.abs(c.t - r.detectedSec!) < 0.001) : null;
  if (picked && picked.x != null && picked.y != null && Math.abs(picked.t - t) <= SEED_AGREE_SEC) {
    return { x: picked.x, y: picked.y, t: picked.t, sizePx: sizeNear(picked.x, picked.y, picked.t) };
  }
  // No clean crossing: the nearest moving thing to the moment, if anything moved there at all.
  let best: { x: number; y: number; t: number } | null = null;
  for (const s of scanner.samples) {
    if (Math.abs(s.t - t) > SEED_AGREE_SEC) continue;
    if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = { x: s.x, y: s.y, t: s.t };
  }
  return best ? { ...best, sizePx: sizeNear(best.x, best.y, best.t) } : null;
}

/** Trace one lap. Throws `Aborted` when the caller cancels. */
export async function traceLapInBrowser(opts: TraceLapOptions): Promise<TraceLapOutcome> {
  const {
    video,
    file = null,
    frameW,
    frameH,
    lines,
    startSec,
    endSec,
    car = null,
    onProgress,
    signal,
  } = opts;
  const startedAt = performance.now();
  const report = (fraction: number, note: string) => onProgress?.({ fraction, note });
  const geomByKey = new Map<string, LineGeom>();
  for (const l of lines) geomByKey.set(l.lineKey, lineGeom(l, frameW, frameH));

  const anchors: LapAnchor[] = [...opts.anchors].sort((a, b) => a.t - b.t).map((a) => ({ ...a }));
  /** The car's apparent length at a seeded crossing, by the crossing's time. */
  const sizeAt = new Map<number, number>();
  const carPxAt = (t: number): number => {
    let i = 0;
    while (i < anchors.length - 2 && anchors[i + 1]!.t <= t) i++;
    const a = anchors[i];
    const b = anchors[i + 1];
    if (!a || !b) return MIN_CAR_PX;
    const frac = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return carPxBetween(geomByKey.get(a.lineKey) ?? null, geomByKey.get(b.lineKey) ?? null, frac);
  };
  let maxCarPx = MIN_CAR_PX;
  for (const g of geomByKey.values()) maxCarPx = Math.max(maxCarPx, carPxBetween(g, g, 0));

  // The biggest rectangle read is a line's ROI for seeding, or the widest lost window.
  let maxW = 8;
  let maxH = 8;
  for (const l of lines) {
    const r = roiFor(l, frameW, frameH);
    maxW = Math.max(maxW, r.x1 - r.x0);
    maxH = Math.max(maxH, r.y1 - r.y0);
  }
  // A lost window may grow to a share of the frame (`windowAt`); the canvas must hold it.
  const lostSide = Math.round(Math.min(frameW, frameH, frameW * MAX_LOST_WINDOW_FRAC));
  const reader = new CropReader(Math.max(maxW, lostSide), Math.max(maxH, lostSide));

  report(0, "Waking the decoder…");
  const source = await openFrameSource(video, file);
  const seeded: TraceLapOutcome["seeded"] = [];
  let framesRead = 0;
  let starved = false;
  try {
    checkAbort(signal);

    // Every crossing is read for a moment either side: a position for the ones the scan kept
    // none for, the car's size at each, and — once per line — how that line's band reads, the
    // way the crossing scan calibrates every line before it looks for anything.
    const calByLine = new Map<string, LineCalibration>();
    for (const [i, a] of anchors.entries()) {
      checkAbort(signal);
      const line = lines.find((l) => l.lineKey === a.lineKey);
      report((i / anchors.length) * 0.15, `Reading ${line?.label ?? a.lineKey}`);
      if (!line) continue;
      const known = calByLine.get(a.lineKey) ?? null;
      const keep = known ? undefined : { colour: [] as FrameCrop[], luma: [] as FrameCrop[] };
      const hit = await seedAtLine(source, reader, line, a.t, frameW, frameH, car, signal, known, keep);
      if (keep && keep.colour.length >= 3) {
        const roi = roiFor(line, frameW, frameH);
        const band = bandMask(line, roi, frameW, frameH, ACTIVE_RECIPE);
        const spans = spansFromMask(band, roi.x1 - roi.x0, roi.y1 - roi.y0);
        const cal = calibrateFromFrames(keep.colour, keep.luma, band, spans, blurKernelForLine(line, frameW, frameH, ACTIVE_RECIPE));
        calByLine.set(a.lineKey, cal);
        console.debug(`[trace] cal ${line.lineKey} → ${cal.mode} @ ${cal.thresh} (luma ${thresholdFor(cal, "luma")}, colour ${thresholdFor(cal, "colour")}) · ${cal.reason}`);
      }
      if (hit?.sizePx != null) sizeAt.set(a.t, hit.sizePx);
      if (a.x == null || a.y == null) {
        seeded.push({ lineKey: a.lineKey, t: a.t, found: !!hit });
        if (hit) {
          a.x = hit.x;
          a.y = hit.y;
        }
      }
    }
    // One channel for the whole lap, the one most lines preferred (a tie goes to brightness,
    // which the far lines read on); each stretch at the gentler of its two lines' gates.
    const modes = [...calByLine.values()].map((c) => c.mode);
    const luma = modes.filter((m) => m === "luma").length >= modes.length / 2;
    const mode: ChannelMode = luma ? "luma" : "colour";
    const gateOf = (key: string): number => {
      const c = calByLine.get(key);
      return c ? thresholdFor(c, mode) : ACTIVE_RECIPE.thresh;
    };
    const gateAt = (t: number): number => {
      let i = 0;
      while (i < anchors.length - 2 && anchors[i + 1]!.t <= t) i++;
      const a = anchors[i];
      const b = anchors[i + 1];
      if (!a || !b) return ACTIVE_RECIPE.thresh;
      return Math.min(gateOf(a.lineKey), gateOf(b.lineKey));
    };
    const byLine: Record<string, number> = {};
    for (const key of calByLine.keys()) byLine[key] = gateOf(key);
    const thresh = opts.thresh ?? gateAt(startSec);
    const tracer = new LapTracer({
      frameW,
      frameH,
      carPx: carPxAt(startSec),
      maxCarPx,
      thresh,
      recipeMinArea: ACTIVE_RECIPE.minArea,
      channels: luma ? 1 : 4,
    });
    // The track's own shape, from whatever has been followed before. Only stretches this lap
    // also runs are of any use, but the road does not know that and does not need to.
    const road: Road | null = opts.priors?.length ? roadFrom(opts.priors, { w: frameW, h: frameH }) : null;
    const roadAt = (t: number): { x: number; y: number; sure: boolean } | null => {
      if (!road) return null;
      let i = 0;
      while (i < anchors.length - 2 && anchors[i + 1]!.t <= t) i++;
      const a = anchors[i];
      const b = anchors[i + 1];
      if (!a || !b || !(b.t > a.t)) return null;
      const at = road.at(a.lineKey, b.lineKey, (t - a.t) / (b.t - a.t));
      return at ? { ...at, sure: a.x != null && b.x != null } : null;
    };
    if (road) console.debug(`[trace] road from ${opts.priors!.length} traced laps · ${road.stretches.join(" ") || "nothing usable"}`);

    const pinned = anchors.filter((a) => a.x != null && a.y != null);
    console.debug(
      `[trace] anchors ${anchors.length} pinned ${pinned.length} · ` +
        anchors
          .map((a) => `${a.lineKey}@${a.t.toFixed(2)}${a.x != null ? "" : "?"}${sizeAt.has(a.t) ? ` car ${sizeAt.get(a.t)!.toFixed(0)}px` : ""}`)
          .join(" ")
    );

    // The empty track first, so every frame of the lap can be read against it.
    report(0.12, "Learning the empty track…");
    const bgFrom = Math.max(0, startSec - LAP_MARGIN_SEC);
    const bgTo = endSec + LAP_MARGIN_SEC;
    const background = await emptyTrack(source, frameW, frameH, luma, bgFrom, bgTo, signal);
    tracer.setBackground(background);
    console.debug(
      `[trace] empty track ${background ? `built from ${BACKGROUND_FRAMES} frames over ${(bgTo - bgFrom).toFixed(1)}s` : "not built — reading frame against frame"}`
    );

    // The lap, read once. The tracer is re-aimed at every pinned crossing it passes.
    const first = pinned[0] ?? null;
    if (first) tracer.seed(first.x!, first.y!, first.t, sizeAt.get(first.t));
    let nextPin = first ? 1 : 0;
    const span = endSec - startSec;
    let lastReport = 0;
    const range = await source.readRange(
      Math.max(0, startSec - LAP_MARGIN_SEC),
      endSec + LAP_MARGIN_SEC,
      1,
      (image, t) => {
        framesRead++;
        while (nextPin < pinned.length && pinned[nextPin]!.t <= t) {
          const pin = pinned[nextPin]!;
          tracer.seed(pin.x!, pin.y!, pin.t, sizeAt.get(pin.t));
          nextPin++;
        }
        const aimAnchor = pinned[nextPin];
        const aim: Sighting | null = aimAnchor ? { t: aimAnchor.t, x: aimAnchor.x!, y: aimAnchor.y! } : null;
        tracer.retune(carPxAt(t));
        tracer.setThresh(opts.thresh ?? gateAt(t));
        tracer.setHint(roadAt(t));
        const roi = tracer.windowAt(t, aim);
        const crop = reader.read(image, roi);
        tracer.push(luma ? reader.toLuma(crop) : crop, roi, t, aim, crop);
        if (t - lastReport > 0.5) {
          lastReport = t;
          report(0.15 + 0.75 * Math.max(0, Math.min(1, (t - startSec) / span)), `Following the car · ${Math.round(t - startSec)}s`);
        }
      },
      signal
    );
    starved = range.starved;

    // The path, sector by sector between the pinned crossings.
    report(0.92, "Choosing the path");
    const frames: ObsFrame[] = tracer.frames;
    const chains: ChainResult[] = [];
    const chainCarPx: number[] = [];
    const chainAnchor = (a: LapAnchor | undefined): ChainAnchor | null =>
      a ? { t: a.t, x: a.x, y: a.y } : null;
    const bounds: Array<{ from: LapAnchor | null; to: LapAnchor | null }> = [];
    if (pinned.length === 0) {
      bounds.push({ from: null, to: null });
    } else {
      if (pinned[0]!.t > startSec + 0.05) bounds.push({ from: null, to: pinned[0]! });
      for (let i = 0; i < pinned.length - 1; i++) bounds.push({ from: pinned[i]!, to: pinned[i + 1]! });
      if (pinned[pinned.length - 1]!.t < endSec - 0.05) bounds.push({ from: pinned[pinned.length - 1]!, to: null });
    }
    for (const b of bounds) {
      const fromT = b.from?.t ?? startSec - LAP_MARGIN_SEC;
      const toT = b.to?.t ?? endSec + LAP_MARGIN_SEC;
      const segFrames = frames.filter((f) => f.t > fromT && f.t < toT);
      // How big the car actually looked along this stretch, from the blobs the tracer followed.
      // The sector lines' guess is the fallback: on a fisheye every line is at the far end, and a
      // car passing under the camera between two of them is four times what either line suggests.
      const seen = tracer.sizeAtT
        .filter((x) => x.t > fromT && x.t < toT)
        .map((x) => x.px)
        .sort((a, b) => a - b);
      const carPx = seen.length >= 5 ? seen[seen.length >> 1]! : carPxAt((fromT + toT) / 2);
      chainCarPx.push(carPx);
      const result = chainThrough(segFrames, chainAnchor(b.from ?? undefined), chainAnchor(b.to ?? undefined), {
        ...defaultChainParams(carPx),
        car,
      });
      chains.push(result);
      console.debug(
        `[trace] ${b.from?.lineKey ?? "start"}→${b.to?.lineKey ?? "end"} frames ${result.frames} placed ${result.points.length} holes ${result.holes.length} ambiguous ${result.ambiguousFrames} cost ${result.cost.toFixed(1)} car ${carPx.toFixed(0)}px`
      );
    }

    const carPxAtAnchor = (t: number): number => sizeAt.get(t) ?? carPxAt(t);
    const trace = stitchTrace({
      sessionId: opts.sessionId,
      driverRole: opts.driverRole,
      lapNumber: opts.lapNumber,
      frame: { w: frameW, h: frameH },
      startSec,
      endSec,
      anchors: anchors.map((a) => ({ lineKey: a.lineKey, t: a.t, x: a.x, y: a.y })),
      chains,
      frames,
      shookAt: tracer.shookAt,
      carPxAt: carPxAtAnchor,
      starved,
    });
    const q = trace.quality;
    console.debug(
      `[trace] done ${opts.driverRole} L${opts.lapNumber} · ${framesRead} frames in ${Math.round(performance.now() - startedAt)}ms (${source.kind}${starved ? " STARVED" : ""}, ${mode} @ ${Object.entries(byLine).map(([k, v]) => `${k}:${v}`).join(" ") || thresh}) · coverage ${q.coverage.toFixed(2)} anchors ${q.anchorsHit}/${q.anchorsTotal} ambiguous ${q.ambiguousFrames} shake ${tracer.shakeFrames} · ${q.ok ? "OK" : "NOT OK"} · per frame draw ${(reader.drawMs / Math.max(1, framesRead)).toFixed(1)} read ${(reader.readMs / Math.max(1, framesRead)).toFixed(1)}ms · ` +
        trace.segments
          .map((s) => {
            const f = s.frames;
            // Of the frames this sector could not place the car in: how many held nothing moving
            // at all, and how many were thrown out as the camera moving rather than the car.
            const why = f
              ? ` blind ${f.read - f.saw} shake ${f.shake}`
              : "";
            return `${s.fromKey}→${s.toKey} ${(s.coverage * 100).toFixed(0)}%${why} err ${fmtErr(s.anchorErr.from)}/${fmtErr(s.anchorErr.to)}`;
          })
          .join(" · ")
    );
    const dump = (globalThis as { __traceDump?: TraceDump[] }).__traceDump;
    if (dump) {
      dump.push({
        sessionId: opts.sessionId,
        driverRole: opts.driverRole,
        lapNumber: opts.lapNumber,
        frame: { w: frameW, h: frameH },
        startSec,
        endSec,
        anchors: anchors.map((a) => ({ lineKey: a.lineKey, t: a.t, x: a.x ?? null, y: a.y ?? null })),
        frames,
        sizeAtT: tracer.sizeAtT,
        shookAt: tracer.shookAt,
        carPxAtAnchor: anchors.map((a) => [a.t, carPxAtAnchor(a.t)] as [number, number]),
        chainCarPx,
        car: car ?? null,
        starved,
      });
    }
    report(1, "Done");
    return {
      trace,
      reader: source.kind,
      calibration: calByLine.size ? { mode, byLine } : null,
      elapsedMs: performance.now() - startedAt,
      framesRead,
      seeded,
    };
  } finally {
    await source.close();
    try {
      video.pause();
    } catch {
      /* the element may be torn down mid-trace */
    }
  }
}

function fmtErr(e: number | null): string {
  return e == null ? "-" : e.toFixed(1);
}
