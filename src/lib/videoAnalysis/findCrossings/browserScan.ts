"use client";

/**
 * Run the crossing detector against a `<video>` element, in the browser.
 *
 * The detector itself is pure arithmetic over pixel crops; this is the only part that knows
 * about decoding, and it is deliberately the dumbest thing that works everywhere: seek, play,
 * and take each frame as the browser presents it via `requestVideoFrameCallback`.
 *
 * Three things about that are load-bearing:
 *
 *  - **`mediaTime` is the frame's own timestamp**, not a clock reading. This footage is variable
 *    frame rate (nominal 59.94, real average 31.5), so any timeline computed from a frame rate
 *    drifts by seconds across a heat and mispairs every frame with the wrong time.
 *  - **Playback stays at 1x by default.** The callback only fires for frames the browser actually
 *    presents, and at higher rates it presents fewer of them — which costs exactly the sub-frame
 *    precision the whole method exists for. Speed comes from decoding less, not faster.
 *  - **Windows are merged before decoding.** Two corners a second and a half apart have
 *    overlapping search windows, so they are read in one pass rather than two, and the video is
 *    seeked once instead of twice. Seeking a 4K file is the expensive part.
 *
 * Colour handling differs from the offline harness by necessity. There, brightness came straight
 * off the decoder's own luma plane. A canvas only ever hands back RGBA, so brightness has to be
 * recovered from it — see `LUMA_WEIGHTS`. The per-line calibration measures whether that recovery
 * is clean enough on this footage and picks accordingly, so a contaminated recovery degrades to
 * "read colour" rather than to a wrong answer.
 */

import {
  WindowScanner,
  resultFromWindow,
  type TrackedResult,
} from "./detector";
import { bandMask, roiFor } from "./geometry";
import { spansFromMask } from "./spans";
import {
  bandFrameDiffs,
  calibrateFromDiffs,
  type LineCalibration,
} from "./calibrate";
import type { CarColour } from "./carColour";
import type { CarColours } from "./field";
import { RECIPE_B22_T14, type CrossingTarget, type FrameCrop, type Roi, type SectorLine } from "./types";

/**
 * Rec.709 luma weights. This recovers brightness from decoded RGB; it is NOT the decoder's luma
 * plane, and the two differ by however much chroma leaks back through the matrix the browser
 * happened to use. That is measured per line rather than assumed — a band where the recovery is
 * still noisy simply fails the colour-vs-brightness comparison in `calibrate.ts` and is read some
 * other way.
 */
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

/**
 * The canvas must NOT be marked read-frequently, despite reading every frame.
 *
 * That hint moves the canvas to CPU-backed storage, which makes `getImageData` cheap and
 * `drawImage` from a 4K HDR video ruinous — the whole frame gets converted in software on every
 * call. Measured on this footage: 93.8ms per frame with the hint, 0.2ms without, and the readback
 * only rose from 1.3ms to 6.7ms because it covers one small crop rather than the whole picture.
 * That is 4 frames a second against 27 — the difference between a detector that works and one
 * that sees one frame in seven.
 */
const READ_FREQUENTLY = false;

/** Seconds either side of a prediction to decode. */
export const DEFAULT_WINDOW_SEC = 2.0;
/** Two windows closer than this are read in one pass rather than two. */
const SEGMENT_JOIN_SEC = 0.6;
/** Longest single decode pass, so progress keeps moving and a stall is bounded. */
const MAX_SEGMENT_SEC = 20;
/** A seek that never lands — Safari can swallow one on an element that has never played. */
const SEEK_TIMEOUT_MS = 20000;
/**
 * Frames must arrive at least this often IN VIDEO TIME. The browser only hands over frames it
 * actually presents, and a tab that loses focus or falls behind presents far fewer — one run of
 * this scan collected 1332 frames where an identical run collected 2198, with no error anywhere.
 * Below this rate the sub-frame interpolation is meaningless, so the stretch is reported as not
 * found rather than answered badly. A gap is honest; a wrong mark is not.
 */
const STARVED_MEDIA_GAP_MS = 100;
/**
 * When a stretch comes back starved, read it again slower rather than losing it.
 *
 * Playing at half speed doubles the time the page has to handle each frame while reading exactly
 * the same frames — the browser paints on its own schedule, and every frame it paints is one we
 * get. Costs wall clock only on the stretches that need it, which is why the common case is not
 * slowed down to protect the rare one. A stretch with all five lines active costs about five
 * times a single narrow window, so this is the difference between the learning pass working and
 * returning nothing at all.
 */
const SLOWDOWN_FACTOR = 0.5;
const SLOWDOWN_ATTEMPTS = 2;
const MIN_PLAYBACK_RATE = 0.2;
/** How far before the range a frame may sit and still count as part of it. */
const PRE_ROLL_TOLERANCE_SEC = 0.05;
/** Frames left over from before the seek that may be skipped before giving up on the range. */
const MAX_STALE_FRAMES = 30;

/** Sample clips used to measure each band. Short, and spread across the targets. */
const CAL_CLIPS: number = 4;
const CAL_CLIP_SEC = 1.2;

export type ScanPhase = "preparing" | "calibrating" | "scanning";

export type ScanProgress = {
  phase: ScanPhase;
  /** 0..1 across the whole job, calibration included. */
  fraction: number;
  note: string;
};

export type BrowserScanOptions = {
  video: HTMLVideoElement;
  frameW: number;
  frameH: number;
  lines: SectorLine[];
  targets: CrossingTarget[];
  windowSec?: number;
  playbackRate?: number;
  /**
   * Reference colour of the car being followed. When supplied, candidates of the wrong colour are
   * discarded before anything else looks at them — the only thing that separates two cars crossing
   * the same line within a few tenths of each other.
   */
  car?: CarColour | null;
  /**
   * Reference colours per scanned driver. A target's own driver's reference is used for its
   * tiebreak — Sandy's windows must not be judged against Jordan's paint. Falls back to `car`.
   */
  cars?: CarColours;
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
};

/**
 * Where the time actually goes. Frame throughput is the thing that decides whether this method
 * works at all in a browser — the detector needs consecutive frames, and any frame the page is
 * too busy to collect is a frame the car was never seen in.
 */
export type ScanTimings = {
  /** `drawImage` — pulling the crop out of the video texture. */
  drawMs: number;
  /** `getImageData` — the synchronous GPU-to-CPU readback. */
  readMs: number;
  /** Turning RGBA into brightness. */
  lumaMs: number;
  /** The detector itself. */
  detectMs: number;
  /** Gaps between consecutive frames handed over, in ms — the honest measure of what was missed. */
  medianFrameGapMs: number;
};

/** Per decode pass, so a stretch that quietly returned nothing can be seen rather than inferred. */
export type SegmentReport = {
  from: number;
  to: number;
  targets: number;
  frames: number;
  wallMs: number;
  /** Median step between consecutive frames IN VIDEO TIME — the test for missed frames. */
  medianMediaGapMs: number;
  /** True when frames arrived too sparsely to trust; this stretch is reported as not found. */
  starved: boolean;
  /** Playback speed this stretch was finally read at. Below 1 means it needed a slower pass. */
  rate: number;
};

export type BrowserScanResult = {
  results: TrackedResult[];
  segments: SegmentReport[];
  /** Stretches the browser could not feed fast enough. Their targets come back as not found. */
  starvedSegments: number;
  calibrations: Record<string, LineCalibration>;
  framesRead: number;
  elapsedMs: number;
  timings: ScanTimings;
};

/** Mutable accumulator threaded through the scan; summarised into `ScanTimings` at the end. */
type Meter = { drawMs: number; readMs: number; lumaMs: number; detectMs: number; gaps: number[] };

class Aborted extends Error {
  constructor() {
    super("scan cancelled");
    this.name = "Aborted";
  }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Aborted();
}

/** True when the scan was stopped by the caller rather than by a fault. */
export function isScanAborted(e: unknown): boolean {
  return e instanceof Error && e.name === "Aborted";
}

/**
 * One line's crop, read straight out of the video into buffers that are reused every frame.
 * Allocating per frame at 4K is what makes a naive version unusably slow.
 */
class LineCrop {
  readonly roi: Roi;
  readonly width: number;
  readonly height: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rgba: Uint8Array;
  private readonly luma: Uint8Array;

  constructor(line: SectorLine, frameW: number, frameH: number) {
    this.roi = roiFor(line, frameW, frameH);
    this.width = this.roi.x1 - this.roi.x0;
    this.height = this.roi.y1 - this.roi.y0;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: READ_FREQUENTLY });
    if (!ctx) throw new Error("Could not open a 2D canvas to read the video.");
    this.ctx = ctx;
    this.rgba = new Uint8Array(this.width * this.height * 4);
    this.luma = new Uint8Array(this.width * this.height);
  }

  /**
   * Read this line's rectangle out of the current video frame.
   * Both views share one readback — the expensive part is `getImageData`, not the arithmetic.
   */
  read(video: HTMLVideoElement, meter?: Meter): { colour: FrameCrop; luma: FrameCrop } {
    const t0 = performance.now();
    this.ctx.drawImage(
      video,
      this.roi.x0,
      this.roi.y0,
      this.width,
      this.height,
      0,
      0,
      this.width,
      this.height
    );
    const t1 = performance.now();
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    this.rgba.set(img.data);
    const t2 = performance.now();
    const [wr, wg, wb] = LUMA_WEIGHTS;
    for (let p = 0, i = 0; p < this.luma.length; p++, i += 4) {
      this.luma[p] = (this.rgba[i] * wr + this.rgba[i + 1] * wg + this.rgba[i + 2] * wb + 0.5) | 0;
    }
    if (meter) {
      meter.drawMs += t1 - t0;
      meter.readMs += t2 - t1;
      meter.lumaMs += performance.now() - t2;
    }
    return {
      colour: { width: this.width, height: this.height, channels: 4, data: this.rgba },
      luma: { width: this.width, height: this.height, channels: 1, data: this.luma },
    };
  }
}

/**
 * Seek and wait for it to land.
 *
 * Belt and braces on purpose: Safari can complete a seek on a never-played element without ever
 * firing `seeked`, so the position is polled too, and the whole thing gives up rather than
 * hanging the button forever.
 */
function seekTo(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let poll = 0;
    let timer = 0;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      signal?.removeEventListener("abort", onAbort);
      window.clearInterval(poll);
      window.clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onSeeked = () => done();
    const onAbort = () => done(new Aborted());
    video.addEventListener("seeked", onSeeked);
    signal?.addEventListener("abort", onAbort);
    poll = window.setInterval(() => {
      if (!video.seeking && Math.abs(video.currentTime - t) < 0.5 && video.readyState >= 2) done();
    }, 200);
    timer = window.setTimeout(
      () => done(new Error(`The video did not respond to a seek to ${t.toFixed(1)}s.`)),
      SEEK_TIMEOUT_MS
    );
    video.currentTime = t;
  });
}

type FrameHandler = (mediaTime: number) => void;

/** Play from here to `to`, handing every presented frame to `onFrame`. */
/**
 * Play from `from` to `to`, handing over every frame the browser presents in between.
 *
 * `from` matters as much as `to`. A seek does not clear what is already on screen, so the first
 * callback after one routinely delivers the frame that was showing BEFORE it — and when the
 * previous stretch was later in the video, that stale frame is already past `to`, which used to
 * end the pass before it had read anything. The stretch then came back with no frames at all and
 * was reported as too slow to read, which sent two debugging sessions after a performance problem
 * that did not exist. So frames outside the range are skipped until one lands inside it.
 */
function playRange(
  video: HTMLVideoElement,
  from: number,
  to: number,
  rate: number,
  onFrame: FrameHandler,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle = 0;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      video.removeEventListener("ended", onEnded);
      if (handle && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handle);
      video.pause();
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => done(new Aborted());
    const onEnded = () => done();
    signal?.addEventListener("abort", onAbort);
    video.addEventListener("ended", onEnded);

    if (!("requestVideoFrameCallback" in video)) {
      done(new Error("This browser cannot hand over video frames — try Chrome or Edge."));
      return;
    }

    let entered = false;
    let skipped = 0;
    const tick: VideoFrameRequestCallback = (_now, meta) => {
      if (settled) return;
      const t = meta.mediaTime;
      if (!entered) {
        if (t < from - PRE_ROLL_TOLERANCE_SEC || t > to) {
          // Left over from wherever the video was before the seek. Give it a few frames to
          // catch up rather than mistaking it for the end of the range.
          if (++skipped > MAX_STALE_FRAMES) {
            done();
            return;
          }
          handle = video.requestVideoFrameCallback(tick);
          return;
        }
        entered = true;
      }
      if (t > to) {
        done();
        return;
      }
      try {
        onFrame(t);
      } catch (e) {
        done(e as Error);
        return;
      }
      handle = video.requestVideoFrameCallback(tick);
    };

    video.playbackRate = rate;
    handle = video.requestVideoFrameCallback(tick);
    video.play().catch((e: Error) => done(e));
  });
}

type Segment = { from: number; to: number; targets: CrossingTarget[] };

/**
 * The stretch of video one target needs.
 *
 * A target may carry its own bounds instead of a window either side of a guess: a lap that lost
 * several seconds gets a wider search, and a corner missed on the first pass gets bracketed
 * between the corners either side of it — which is not a window at all, but a certainty.
 */
export function searchRange(t: CrossingTarget, windowSec: number): { from: number; to: number } {
  return {
    from: t.searchFrom ?? t.centerSec - windowSec,
    to: t.searchTo ?? t.centerSec + windowSec,
  };
}

/** Merge overlapping search windows so the video is read once per stretch, not once per target. */
export function segmentsFor(targets: CrossingTarget[], windowSec: number): Segment[] {
  const sorted = [...targets].sort(
    (a, b) => searchRange(a, windowSec).from - searchRange(b, windowSec).from
  );
  const out: Segment[] = [];
  for (const t of sorted) {
    const { from, to } = searchRange(t, windowSec);
    const last = out[out.length - 1];
    if (last && from <= last.to + SEGMENT_JOIN_SEC && to - last.from <= MAX_SEGMENT_SEC) {
      last.to = Math.max(last.to, to);
      last.targets.push(t);
    } else {
      out.push({ from, to, targets: [t] });
    }
  }
  return out;
}

/**
 * Measure each line's band on a few short clips, so colour-vs-brightness and the motion
 * threshold are decided from this footage rather than from constants fitted to another video.
 *
 * The clips are not chosen to be quiet — on a busy heat there is no quiet moment, and the
 * comparison in `calibrate.ts` is built to see through traffic.
 */
async function calibrate(
  video: HTMLVideoElement,
  crops: Map<string, LineCrop>,
  lines: SectorLine[],
  frameW: number,
  frameH: number,
  spread: { from: number; to: number },
  rate: number,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<Record<string, LineCalibration>> {
  const colourFrames = new Map<string, FrameCrop[]>();
  const lumaFrames = new Map<string, FrameCrop[]>();
  for (const line of lines) {
    colourFrames.set(line.lineKey, []);
    lumaFrames.set(line.lineKey, []);
  }

  const span = Math.max(0, spread.to - spread.from - CAL_CLIP_SEC);
  for (let i = 0; i < CAL_CLIPS; i++) {
    checkAbort(signal);
    const at = spread.from + (CAL_CLIPS === 1 ? 0 : (i / (CAL_CLIPS - 1)) * span);
    await seekTo(video, at, signal);
    await playRange(
      video,
      at,
      at + CAL_CLIP_SEC,
      rate,
      () => {
        for (const line of lines) {
          const crop = crops.get(line.lineKey)!;
          const { colour, luma } = crop.read(video);
          // Copied, not referenced: the crop reuses its buffers every frame.
          colourFrames.get(line.lineKey)!.push({ ...colour, data: new Uint8Array(colour.data) });
          lumaFrames.get(line.lineKey)!.push({ ...luma, data: new Uint8Array(luma.data) });
        }
      },
      signal
    );
    onProgress(i + 1, CAL_CLIPS);
  }

  const out: Record<string, LineCalibration> = {};
  for (const line of lines) {
    const crop = crops.get(line.lineKey)!;
    const band = bandMask(line, crop.roi, frameW, frameH, RECIPE_B22_T14);
    const spans = spansFromMask(band, crop.width, crop.height);
    const cd = bandFrameDiffs(colourFrames.get(line.lineKey)!, band, spans);
    const ld = bandFrameDiffs(lumaFrames.get(line.lineKey)!, band, spans);
    const n = Math.min(cd.length, ld.length);
    out[line.lineKey] = calibrateFromDiffs(cd.slice(0, n), ld.slice(0, n));
  }
  return out;
}

/** Find every requested crossing. Throws `Aborted` if the caller cancels. */
export async function findCrossingsInBrowser(
  opts: BrowserScanOptions
): Promise<BrowserScanResult> {
  const {
    video,
    frameW,
    frameH,
    lines,
    targets,
    windowSec = DEFAULT_WINDOW_SEC,
    playbackRate = 1,
    car = null,
    cars = {},
    onProgress,
    signal,
  } = opts;
  const carFor = (target: CrossingTarget): CarColour | null => {
    const role = target.id.split(":")[0];
    const own = role === "me" || role === "competitor" ? cars[role] : undefined;
    return own ?? car;
  };

  const startedAt = performance.now();
  const report = (phase: ScanPhase, fraction: number, note: string) =>
    onProgress?.({ phase, fraction, note });

  report("preparing", 0, "Waking the decoder…");

  const usedKeys = new Set(targets.map((t) => t.lineKey));
  const usedLines = lines.filter((l) => usedKeys.has(l.lineKey));
  const crops = new Map<string, LineCrop>();
  for (const line of usedLines) crops.set(line.lineKey, new LineCrop(line, frameW, frameH));

  const wasMuted = video.muted;
  const wasRate = video.playbackRate;
  const wasTime = video.currentTime;
  video.muted = true;

  try {
    // A never-played element can swallow the first seek outright; one muted play/pause wakes
    // the decode pipeline before anything is timed against it.
    try {
      await video.play();
      video.pause();
    } catch {
      /* autoplay policy — the seeks below usually still work */
    }
    checkAbort(signal);

    const segments = segmentsFor(targets, windowSec);
    const spanFrom = Math.min(...segments.map((sg) => sg.from));
    const spanTo = Math.max(...segments.map((sg) => sg.to));

    // Calibration is roughly a fifth of the work; the split keeps the bar honest rather than
    // sitting at zero and then jumping.
    const CAL_SHARE = 0.15;
    const calibrations = await calibrate(
      video,
      crops,
      usedLines,
      frameW,
      frameH,
      { from: spanFrom, to: spanTo },
      playbackRate,
      (done, total) =>
        report("calibrating", (done / total) * CAL_SHARE, `Reading the lines (${done}/${total})`),
      signal
    );

    for (const line of usedLines) {
      const cal = calibrations[line.lineKey];
      if (cal) report("calibrating", CAL_SHARE, `${line.label}: ${cal.reason}`);
    }

    const results: TrackedResult[] = [];
    let framesRead = 0;
    const meter: Meter = { drawMs: 0, readMs: 0, lumaMs: 0, detectMs: 0, gaps: [] };
    let lastFrameAt = 0;
    const segmentReports: SegmentReport[] = [];
    let starvedSegments = 0;

    for (const [si, segment] of segments.entries()) {
      checkAbort(signal);
      report(
        "scanning",
        CAL_SHARE + (si / segments.length) * (1 - CAL_SHARE),
        `Crossing ${results.length + 1}–${results.length + segment.targets.length} of ${targets.length}`
      );

      /**
       * Read one stretch once, at a given speed.
       *
       * Separated out because a stretch that arrives starved is worth reading again more slowly
       * rather than throwing away — see the retry below.
       */
      const readSegment = async (rate: number) => {
        // Scanners live only as long as one attempt: each holds several buffers the size of its
        // crop, and they accumulate state, so a retry needs fresh ones.
        const scanners = segment.targets.map((target) => {
          const line = usedLines.find((l) => l.lineKey === target.lineKey)!;
          const crop = crops.get(target.lineKey)!;
          const cal = calibrations[target.lineKey];
          const scanner = new WindowScanner(
            line,
            crop.roi,
            frameW,
            frameH,
            { ...RECIPE_B22_T14, thresh: cal ? cal.thresh : RECIPE_B22_T14.thresh },
            cal?.mode === "luma" ? 1 : 4
          );
          return {
            target,
            scanner,
            crop,
            useLuma: cal?.mode !== "colour",
            ...searchRange(target, windowSec),
          };
        });

        const segStart = performance.now();
        const segFramesBefore = framesRead;
        const mediaGaps: number[] = [];
        let lastMediaTime: number | null = null;
        await seekTo(video, segment.from, signal);
        await playRange(
          video,
          segment.from,
          segment.to,
          rate,
          (t) => {
            framesRead++;
            const now = performance.now();
            if (lastFrameAt) meter.gaps.push(now - lastFrameAt);
            lastFrameAt = now;
            if (lastMediaTime != null && t > lastMediaTime) mediaGaps.push((t - lastMediaTime) * 1000);
            lastMediaTime = t;
            // One readback per line per frame at most, shared by every target on that line.
            const read = new Map<string, { colour: FrameCrop; luma: FrameCrop }>();
            for (const s of scanners) {
              if (t < s.from || t > s.to) continue;
              let frame = read.get(s.target.lineKey);
              if (!frame) {
                frame = s.crop.read(video, meter);
                read.set(s.target.lineKey, frame);
              }
              const d0 = performance.now();
              // The colour view goes in even when motion is read on brightness: noticing that
              // something crossed and knowing WHOSE car it was are different jobs.
              s.scanner.push(s.useLuma ? frame.luma : frame.colour, t, frame.colour);
              meter.detectMs += performance.now() - d0;
            }
          },
          signal
        );

        const sortedGaps = [...mediaGaps].sort((a, b) => a - b);
        const medianMediaGapMs = sortedGaps.length
          ? sortedGaps[Math.floor(sortedGaps.length / 2)]
          : Infinity;
        return {
          scanners,
          medianMediaGapMs,
          starved: medianMediaGapMs > STARVED_MEDIA_GAP_MS,
          frames: framesRead - segFramesBefore,
          wallMs: performance.now() - segStart,
          rate,
        };
      };

      let pass = await readSegment(playbackRate);
      // Slowing the video down is what buys time per frame, because the browser only hands over
      // frames it paints and painting is tied to playback speed. A stretch with every line active
      // costs several times what a single narrow window does, so the same machine that keeps up
      // easily on one keeps up on none here — and the answer is fewer frames per second of wall
      // clock, not fewer frames read.
      for (let attempt = 0; pass.starved && attempt < SLOWDOWN_ATTEMPTS; attempt++) {
        const slower = pass.rate * SLOWDOWN_FACTOR;
        if (slower < MIN_PLAYBACK_RATE) break;
        report(
          "scanning",
          CAL_SHARE + (si / segments.length) * (1 - CAL_SHARE),
          `Too quick to read — going back over it at ${Math.round(slower * 100)}% speed`
        );
        pass = await readSegment(slower);
      }

      const starved = pass.starved;
      if (starved) starvedSegments++;
      // One line per stretch, for the console: the only way to see WHY a scan starved on a
      // machine that decodes the same file perfectly on a bare page.
      console.debug(
        `[scan] ${segment.from.toFixed(2)}–${segment.to.toFixed(2)}s rate ${pass.rate} · ${pass.frames} frames in ${Math.round(pass.wallMs)}ms · median media gap ${Math.round(pass.medianMediaGapMs)}ms${starved ? " STARVED" : ""} · per frame draw ${(meter.drawMs / Math.max(1, framesRead)).toFixed(1)} read ${(meter.readMs / Math.max(1, framesRead)).toFixed(1)} luma ${(meter.lumaMs / Math.max(1, framesRead)).toFixed(1)} detect ${(meter.detectMs / Math.max(1, framesRead)).toFixed(1)}ms`
      );
      segmentReports.push({
        from: segment.from,
        to: segment.to,
        targets: segment.targets.length,
        frames: pass.frames,
        wallMs: pass.wallMs,
        medianMediaGapMs: pass.medianMediaGapMs,
        starved,
        rate: pass.rate,
      });

      for (const s of pass.scanners) {
        const r = resultFromWindow(
          s.target,
          s.scanner.samples,
          s.scanner.frames,
          s.scanner.trackerConfig,
          { car: carFor(s.target) }
        );
        results.push(starved ? { ...r, detectedSec: null, source: null, candidates: [] } : r);
      }
    }

    report("scanning", 1, "Done");
    const gaps = [...meter.gaps].sort((a, b) => a - b);
    return {
      results,
      segments: segmentReports,
      starvedSegments,
      calibrations,
      framesRead,
      elapsedMs: performance.now() - startedAt,
      timings: {
        drawMs: meter.drawMs,
        readMs: meter.readMs,
        lumaMs: meter.lumaMs,
        detectMs: meter.detectMs,
        medianFrameGapMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0,
      },
    };
  } finally {
    video.pause();
    video.playbackRate = wasRate;
    video.muted = wasMuted;
    try {
      video.currentTime = wasTime;
    } catch {
      /* the element may be torn down mid-scan */
    }
  }
}
