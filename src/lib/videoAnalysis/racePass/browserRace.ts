"use client";

/**
 * The race pass in the browser: the file read once, everything that moves followed, the timing
 * sheet deciding who is who.
 *
 * The order below is the whole cost claim, so it is worth stating plainly. **One decode.** The
 * crossing scan reads the file in windows around where it expects each crossing, and the per-lap
 * tracer decodes the file again for every lap traced. This reads the race from end to end once,
 * and out of that single pass comes every driver's path, every sector crossing, and the racing
 * lines the compare step draws — no second decode for any of it.
 *
 * Per frame, two things happen and the second is conditional:
 *
 *  - **The whole picture, small.** Drawn down to a quarter and read back (3.3 ms at 4K, measured
 *    step 0 on 2026-09-08), then turned into everything that moved by `coarse.ts` (5.4 ms). That
 *    is 8.7 ms against a decode of 15–20, so the pass stays decode-bound.
 *  - **A line's strip, full size — only when something is near it.** Most frames touch no line at
 *    all. A line is read while a coarse blob sits in its rectangle and for a few frames after,
 *    which is what gives a crossing its precision: the coarse picture says *which car*, the strip
 *    says *when*, to a fraction of a frame.
 *
 * A line read intermittently must be told when a visit begins (`WindowScanner.resetRun`), or the
 * first frame of one visit is compared against the last frame of the one before and every car
 * that passed in between is reported as having moved in a single frame.
 *
 * Nothing is uploaded. The frames come the way every other reader here gets them
 * (`frameSource.ts`): decoded straight out of the file where the browser can, the player
 * otherwise — and a playback read is never persisted, because its frame times are not the
 * decoder's.
 */

import { medianBackground } from "../trace/background";
import type { ObsFrame } from "../trace/chain";
import { calibrateLines, LineCrop } from "../findCrossings/browserScan";
import type { ChannelMode, LineCalibration } from "../findCrossings/calibrate";
import { thresholdFor } from "../findCrossings/calibrate";
import { eventsFromSamples, WindowScanner } from "../findCrossings/detector";
import { lineGeom, type LineGeom } from "../findCrossings/geometry";
import {
  checkAbort,
  openFrameSource,
  type FrameImage,
  type FrameSource,
  type FrameSourceKind,
} from "../findCrossings/frameSource";
import { ACTIVE_RECIPE, type FrameCrop, type SectorLine } from "../findCrossings/types";
import type { DriverRole } from "@/lib/manualVideoAnalysis/types";
import { calibrateCoarse, coarseDivisorFor, CoarseDetector, trackBounds } from "./coarse";
import { defaultLinkParams, linkTracklets, type LinkResult } from "./link";
import { nameByTheSheet, type NameResult, type SheetDriver } from "./name";
import type { StripCandidate } from "./pathCrossings";
import { sectorCrossings, type SectorResult } from "./sectorCrossings";
import { toSession, type SessionPieces } from "./toSession";

/** See `browserScan.ts`: `willReadFrequently` is a trap on a video source. */
const READ_FREQUENTLY = false;
/** Rec.709, as everything else here recovers brightness from RGBA. */
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
/** Frames the still picture of the empty track is built from, spread over the race. */
const BACKGROUND_FRAMES = 9;
/** Read either side of the race, so the first and last laps have frames before and after them. */
const SPAN_MARGIN_SEC = 2;
/**
 * Frames a line keeps being read for after the last coarse blob left its rectangle.
 *
 * The strip needs a run-up: a crossing is a sign change between two frames, so the frames after a
 * car leaves matter as much as the ones before it arrives.
 */
const STRIP_TAIL_FRAMES = 5;
/**
 * How near a line something has to be, in car lengths, before that line is read at full size.
 *
 * Ten. At racing speed that is about a third of a second of run-up, which is ten frames for the
 * scanner to have a previous frame and for the sign change to be sampled cleanly either side.
 */
const STRIP_NEAR_CAR_LENGTHS = 10;
/** Clips of the coarse picture used to measure its own noise, and how long each is. */
const COARSE_CAL_CLIPS = 3;
const COARSE_CAL_CLIP_SEC = 0.6;
/**
 * How far outside the drawn lines the track is taken to reach, in car lengths.
 *
 * The lines are drawn ACROSS the track at each corner, so their ends already mark its width
 * there. What the hull of them misses is the racing line bulging wide between two corners, which
 * is a handful of car lengths at most.
 */
const TRACK_MARGIN_CAR_LENGTHS = 8;
/** The car's apparent length when nothing has been seen yet, as a share of the frame's width. */
const CAR_FALLBACK_SHARE = 0.01;

export type RaceProgress = { fraction: number; note: string };

export type RacePassOptions = {
  video: HTMLVideoElement;
  file?: Blob | null;
  frameW: number;
  frameH: number;
  durationSec: number;
  /** Every line the driver drew, the start line included. */
  lines: SectorLine[];
  /** Which of them is the start line. */
  sfKey: string;
  /** Everyone the timing sheet knows about, placed on the video clock. */
  sheet: SheetDriver[];
  /** Roles with a seat in this analysis — only these get marks and traces. */
  seatedRoles: Set<DriverRole>;
  sessionId: string;
  onProgress?: (p: RaceProgress) => void;
  signal?: AbortSignal;
};

export type RacePassOutcome = {
  pieces: SessionPieces;
  named: NameResult;
  sectors: SectorResult;
  linked: LinkResult;
  reader: FrameSourceKind;
  /**
   * Read through the player rather than the decoder, so the frame times are the browser's
   * painting schedule rather than the file's. Nothing may be persisted from such a pass.
   */
  starved: boolean;
  elapsedMs: number;
  framesRead: number;
  calibration: { mode: ChannelMode; byLine: Record<string, number> };
  /**
   * Everything the pass SAW, so every decision after it can be made again without reading the
   * file. Reading a race costs a browser and a minute; choosing paths out of what was seen costs
   * nothing, and a rule that has to be tried ten times is otherwise ten minutes of waiting.
   */
  dump: RacePassDump;
};

/** The raw sightings and the inputs the pure stages need — enough to replay everything. */
export type RacePassDump = {
  at: string;
  frameW: number;
  frameH: number;
  scale: number;
  carPx: number;
  sfKey: string;
  lines: SectorLine[];
  sheet: SheetDriver[];
  seatedRoles: string[];
  spans: Span[];
  frames: ObsFrame[];
  /** What the full-resolution strip made of each line. */
  strip: Record<string, StripCandidate[]>;
};

/** The whole frame, drawn down small and read back. One canvas, sized once. */
class CoarseReader {
  readonly w: number;
  readonly h: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rgba: Uint8Array;
  drawMs = 0;
  readMs = 0;

  constructor(
    private readonly frameW: number,
    private readonly frameH: number,
    divisor: number
  ) {
    this.w = Math.max(2, Math.round(frameW / divisor));
    this.h = Math.max(2, Math.round(frameH / divisor));
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: READ_FREQUENTLY });
    if (!ctx) throw new Error("Could not open a 2D canvas to read the video.");
    this.ctx = ctx;
    this.rgba = new Uint8Array(this.w * this.h * 4);
  }

  read(image: FrameImage): FrameCrop {
    const t0 = performance.now();
    this.ctx.drawImage(image, 0, 0, this.frameW, this.frameH, 0, 0, this.w, this.h);
    const t1 = performance.now();
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    this.rgba.set(img.data);
    this.readMs += performance.now() - t1;
    this.drawMs += t1 - t0;
    return { width: this.w, height: this.h, channels: 4, data: this.rgba };
  }
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

export type Span = { fromSec: number; toSec: number };

/**
 * Dead air between one stretch of running and the next. Merged across a gap shorter than this,
 * read separately across a longer one.
 */
const SPAN_JOIN_SEC = 10;

/**
 * The stretches of video anybody was actually on track for.
 *
 * A **race** is one stretch: everyone leaves together, so the sheet's earliest lap start and
 * latest finish bracket the whole thing. **Practice is not**, and assuming it was is the mistake
 * this function exists to stop. On the Bendigo four-driver practice of 2026-09-01 the runs sit
 * end to end down a twenty-nine minute file — Cooper 50–615 s, Justin 758–1073 s, Jordan
 * 1290–1843 s, Sandy 1562–1900 s — so one bracket over the lot is 1699 seconds, about 51 000
 * frames, of which six minutes is an empty track between runs. Reading each stretch and skipping
 * what lies between costs the same as the running itself and nothing more.
 *
 * It does not make a long session short: reading every lap of a nine-minute run takes nine
 * minutes of decoding, and no arrangement of windows changes that. It removes the waste, which
 * here is about a fifth.
 */
export function raceSpans(sheet: SheetDriver[], durationSec: number): Span[] {
  const raw: Span[] = [];
  for (const d of sheet) {
    for (const l of d.laps) {
      const to = l.startSec + Math.max(0, l.lapTimeSec);
      if (!(to > l.startSec)) continue;
      raw.push({ fromSec: l.startSec, toSec: to });
    }
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a.fromSec - b.fromSec);
  const merged: Span[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.fromSec <= last.toSec + SPAN_JOIN_SEC) {
      last.toSec = Math.max(last.toSec, s.toSec);
    } else {
      merged.push({ ...s });
    }
  }
  const limit = durationSec > 0 ? durationSec : merged[merged.length - 1]!.toSec + SPAN_MARGIN_SEC;
  return merged
    .map((s) => ({
      fromSec: Math.max(0, s.fromSec - SPAN_MARGIN_SEC),
      toSec: Math.min(limit, s.toSec + SPAN_MARGIN_SEC),
    }))
    .filter((s) => s.toSec > s.fromSec);
}

/** The whole thing end to end, for the record — not what gets read. */
export function raceSpan(sheet: SheetDriver[], durationSec: number): Span | null {
  const spans = raceSpans(sheet, durationSec);
  if (!spans.length) return null;
  return { fromSec: spans[0]!.fromSec, toSec: spans[spans.length - 1]!.toSec };
}

/** How far a point is from a drawn line segment, in full-frame pixels. */
function distanceToLine(px: number, py: number, g: LineGeom): number {
  const len2 = g.norm * g.norm;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - g.p1x) * g.dx + (py - g.p1y) * g.dy) / len2)) : 0;
  return Math.hypot(px - (g.p1x + g.dx * t), py - (g.p1y + g.dy * t));
}

/**
 * Is anything moving near enough to this line to be worth reading it at full resolution?
 *
 * Distance from the **line**, not from its decode rectangle. The rectangle is deliberately
 * generous — a couple of hundred pixels of padding at 4K, several per cent of the frame each —
 * and with seven lines it covers a third of the picture, so anything moving anywhere lights up
 * most of them. Measured 2026-09-08: 23 808 strip reads over 3 559 frames, near enough all seven
 * lines every frame, at 53 ms a frame. A car ten of its own lengths away is not about to cross,
 * and by the time it is, this has been true for a third of a second — plenty of run-up for the
 * scanner to have a previous frame and for the crossing's sign change to be sampled either side.
 */
function anyNear(blobs: ObsFrame["blobs"], g: LineGeom, reachPx: number): boolean {
  for (const b of blobs) {
    if (distanceToLine(b.x, b.y, g) <= reachPx) return true;
  }
  return false;
}

/**
 * Read a race and come back with who did what.
 */
export async function runRacePass(opts: RacePassOptions): Promise<RacePassOutcome> {
  const { video, file = null, frameW, frameH, lines, sfKey, sheet, signal } = opts;
  const startedAt = performance.now();
  const report = (fraction: number, note: string) => opts.onProgress?.({ fraction, note });

  const spans = raceSpans(sheet, opts.durationSec);
  if (!spans.length) throw new Error("The timing sheet does not say when anybody was on track.");
  const span = { fromSec: spans[0]!.fromSec, toSec: spans[spans.length - 1]!.toSec };
  const running = spans.reduce((s, x) => s + (x.toSec - x.fromSec), 0);
  console.debug(
    `[race] ${spans.length} stretch${spans.length === 1 ? "" : "es"} on track, ${running.toFixed(0)}s of ${(span.toSec - span.fromSec).toFixed(0)}s: ${spans.map((s) => `${s.fromSec.toFixed(0)}–${s.toSec.toFixed(0)}`).join(" ")}`
  );
  const sfLine = lines.find((l) => l.lineKey === sfKey);
  if (!sfLine) throw new Error("No start/finish line has been drawn.");
  const cornerLines = lines.filter((l) => l.lineKey !== sfKey).sort((a, b) => a.sortOrder - b.sortOrder);
  // How much to shrink the picture by — enough that a car still has pixels, whatever the frame is.
  const divisor = coarseDivisorFor(frameW);

  report(0, "Waking the decoder…");
  const source: FrameSource = await openFrameSource(video, file);
  let framesRead = 0;

  try {
    checkAbort(signal);

    // Every line's own gate, measured the way the crossing scan measures them: several short
    // clips across the race, and the quietest one is what the band's noise really is.
    report(0.02, "Reading the lines…");
    const crops = new Map<string, LineCrop>();
    for (const line of lines) crops.set(line.lineKey, new LineCrop(line, frameW, frameH));
    const calibrations: Record<string, LineCalibration> = await calibrateLines(
      source,
      crops,
      lines,
      frameW,
      frameH,
      { from: span.fromSec, to: span.toSec },
      1,
      (done, total) => report(0.02 + (done / total) * 0.06, `Reading the lines (${done}/${total})`),
      signal
    );
    const modes = Object.values(calibrations).map((c) => c.mode);
    const luma = modes.filter((m) => m === "luma").length >= modes.length / 2;
    const mode: ChannelMode = luma ? "luma" : "colour";
    const byLine: Record<string, number> = {};
    for (const [key, cal] of Object.entries(calibrations)) {
      byLine[key] = thresholdFor(cal, mode);
      console.debug(`[race] cal ${key} → ${cal.mode} @ ${cal.thresh} · ${cal.reason}`);
    }

    // A still picture of the empty track, from frames spread over the race. Short reads rather
    // than one pass over everything: nine seeks cost seconds, a second decode costs minutes.
    report(0.09, "Building a still picture of the empty track…");
    const coarse = new CoarseReader(frameW, frameH, divisor);
    // Where a given number of seconds *of running* falls on the video clock — the stretches are
    // not contiguous, so this walks them. A frame taken from a different part of the day is a
    // picture of different light, which is not what a still picture of this track should be.
    const atThrough = (through: number): number => {
      let left = through;
      for (const s of spans) {
        const len = s.toSec - s.fromSec;
        if (left <= len) return s.fromSec + left;
        left -= len;
      }
      return spans[spans.length - 1]!.toSec;
    };
    const bgFrames: FrameCrop[] = [];
    for (let i = 0; i < BACKGROUND_FRAMES; i++) {
      checkAbort(signal);
      const at = atThrough((running * i) / BACKGROUND_FRAMES);
      let got = false;
      await source.readRange(at, at + 0.1, 1, (image) => {
        if (got) return;
        got = true;
        const c = coarse.read(image);
        bgFrames.push({ width: c.width, height: c.height, channels: 4, data: new Uint8Array(c.data) });
      });
    }
    const background = medianBackground(bgFrames);
    if (!background) throw new Error("Could not read enough of the video to see the empty track.");
    console.debug(`[race] empty track from ${bgFrames.length} frames over ${(span.toSec - span.fromSec).toFixed(1)}s`);

    // The coarse picture's own gate, measured on the coarse picture. A line's band is a few
    // hundred pixels of tarmac and its gate comes out at 5; the same 5 over a whole 4K frame lets
    // in the trees and the crowd — see `calibrateCoarse`.
    report(0.1, "Reading how quiet the picture is…");
    const coarseClips: FrameCrop[][] = [];
    for (let i = 0; i < COARSE_CAL_CLIPS; i++) {
      checkAbort(signal);
      const at = atThrough((running * (i + 0.5)) / COARSE_CAL_CLIPS);
      const clip: FrameCrop[] = [];
      await source.readRange(at, at + COARSE_CAL_CLIP_SEC, 1, (image) => {
        const c = coarse.read(image);
        clip.push({ width: c.width, height: c.height, channels: 4, data: new Uint8Array(c.data) });
      });
      if (clip.length >= 3) coarseClips.push(clip);
    }
    const coarseThresh = calibrateCoarse(coarseClips);
    console.debug(
      `[race] coarse gate ${coarseThresh} from ${coarseClips.length} clips (lines: ${Object.entries(byLine)
        .map(([k, v]) => `${k} ${v}`)
        .join(" ")})`
    );

    // The car's size, before anything has been seen: a hundredth of the frame's width. The
    // linker measures each tracklet's own from its blobs, so this only has to start it off.
    const carPxGuess = Math.max(6, frameW * CAR_FALLBACK_SHARE);
    // Where the track is. Everything outside it — trees, the stand, the crowd, the car park —
    // moves too, and searching it is what drowned the first real run of this pass.
    const track = trackBounds(
      lines,
      frameW,
      frameH,
      divisor,
      (carPxGuess * TRACK_MARGIN_CAR_LENGTHS) / divisor
    );
    console.debug(
      `[race] track from ${lines.length} lines covers ${(track.share * 100).toFixed(0)}% of the picture`
    );
    const detector = new CoarseDetector({
      w: coarse.w,
      h: coarse.h,
      divisor: divisor,
      thresh: coarseThresh,
      carPx: carPxGuess / divisor,
      bounds: track.spans,
    });
    detector.setBackground(background);

    // One scanner per line, alive for the whole race, fed only while something is near it.
    const scanners = new Map<
      string,
      { scanner: WindowScanner; crop: LineCrop; geom: LineGeom; useLuma: boolean; idle: number }
    >();
    for (const line of lines) {
      const crop = crops.get(line.lineKey)!;
      const cal = calibrations[line.lineKey];
      scanners.set(line.lineKey, {
        scanner: new WindowScanner(
          line,
          crop.roi,
          frameW,
          frameH,
          { ...ACTIVE_RECIPE, thresh: cal ? cal.thresh : ACTIVE_RECIPE.thresh },
          cal?.mode === "luma" ? 1 : 4
        ),
        crop,
        geom: lineGeom(line, frameW, frameH),
        useLuma: cal?.mode !== "colour",
        idle: STRIP_TAIL_FRAMES + 1,
      });
    }

    report(0.12, "Reading the race…");
    const frames: ObsFrame[] = [];
    const sizes: number[] = [];
    let stripReads = 0;
    let coarseMs = 0;
    let stripMs = 0;
    const total = Math.max(0.001, running);
    let done = 0;
    let starvedAny = false;
    for (const stretch of spans) {
      checkAbort(signal);
      // A fresh stretch: the frame before is minutes old, and so is every line's last look.
      detector.forgetPrevious();
      for (const entry of scanners.values()) {
        entry.scanner.resetRun();
        entry.idle = STRIP_TAIL_FRAMES + 1;
      }
      const range = await source.readRange(
      stretch.fromSec,
      stretch.toSec,
      1,
      (image, t) => {
        framesRead++;
        const rgba = coarse.read(image);
        const c0 = performance.now();
        const frame = detector.push(rgba, t);
        coarseMs += performance.now() - c0;
        frames.push({ t: frame.t, blobs: frame.blobs });
        for (const b of frame.blobs) sizes.push(Math.max(b.w, b.h));

        // Only the lines something is actually near, and for a few frames after it has gone.
        const s0 = performance.now();
        for (const entry of scanners.values()) {
          const near = anyNear(frame.blobs, entry.geom, carPxGuess * STRIP_NEAR_CAR_LENGTHS);
          if (near) {
            // A fresh visit: the frame before this one is minutes old and means nothing.
            if (entry.idle > STRIP_TAIL_FRAMES) entry.scanner.resetRun();
            entry.idle = 0;
          } else if (entry.idle <= STRIP_TAIL_FRAMES) {
            entry.idle++;
          } else {
            continue;
          }
          const view = entry.crop.read(image);
          entry.scanner.push(entry.useLuma ? view.luma : view.colour, t, view.colour);
          stripReads++;
        }
        stripMs += performance.now() - s0;

        if (framesRead % 60 === 0) {
          const through = done + (t - stretch.fromSec);
          report(0.12 + (through / total) * 0.78, `Reading the race — ${Math.round(through)}s of ${Math.round(total)}s`);
        }
        // A long read with nothing on the console is a read nobody can tell from a hang.
        if (framesRead % 600 === 0) {
          console.debug(
            `[race] …${framesRead} frames · ${(frame.blobs.length).toString().padStart(2)} moving · ${Math.round(done + (t - stretch.fromSec))}s of ${Math.round(total)}s`
          );
        }
      },
      signal
      );
      if (range.starved) starvedAny = true;
      done += stretch.toSec - stretch.fromSec;
    }

    const starved = source.kind !== "decoded" || starvedAny;
    const readMs = performance.now() - startedAt;
    console.debug(
      `[race] read ${framesRead} frames in ${(readMs / 1000).toFixed(1)}s · per frame draw ${(coarse.drawMs / Math.max(1, framesRead)).toFixed(2)} read ${(coarse.readMs / Math.max(1, framesRead)).toFixed(2)} coarse ${(coarseMs / Math.max(1, framesRead)).toFixed(2)} strip ${(stripMs / Math.max(1, framesRead)).toFixed(2)}ms · strip reads ${stripReads} · shake ${detector.shakeFrames} crowded ${detector.crowdedFrames}${starved ? " STARVED" : ""}`
    );

    // What the strip made of each line over the whole race.
    const candidatesByLine = new Map<string, StripCandidate[]>();
    for (const [key, entry] of scanners) {
      candidatesByLine.set(key, eventsFromSamples(entry.scanner.samples));
    }

    report(0.92, "Following the cars…");
    const carPx = Math.max(6, median(sizes) || carPxGuess);
    const linked = linkTracklets(frames, defaultLinkParams(carPx));
    const lives = linked.tracklets
      .map((t) => t.points[t.points.length - 1]!.t - t.points[0]!.t)
      .sort((a, b) => a - b);
    const ended: Record<string, number> = {};
    for (const t of linked.tracklets) ended[t.endedBy] = (ended[t.endedBy] ?? 0) + 1;
    console.debug(
      `[race] car ${carPx.toFixed(0)}px · tracklets ${linked.tracklets.length} · standing ${linked.standing} short ${linked.tooShort} merges ${linked.merges}` +
        ` · life median ${(lives[lives.length >> 1] ?? 0).toFixed(2)}s p90 ${(lives[Math.floor(lives.length * 0.9)] ?? 0).toFixed(2)}s longest ${(lives[lives.length - 1] ?? 0).toFixed(1)}s` +
        ` · ended ${Object.entries(ended).map(([k, v]) => `${k} ${v}`).join(" ")}`
    );

    report(0.95, "Reading the timing sheet…");
    const named = nameByTheSheet({
      tracklets: linked.tracklets,
      sfLine,
      frameW,
      frameH,
      sheet,
      sfCandidates: candidatesByLine.get(sfKey) ?? [],
      carPx,
    });
    console.debug(
      `[race] named ${sheet
        .map((d) => `${d.name} ${named.laps.filter((l) => l.key === d.key).length}/${Math.max(0, d.laps.length - 1)}`)
        .join(" ")} · unnamed ${named.unnamed} · ties ${named.ties.length} · cuts ${named.cuts} · bridged ${named.bridged} · ${(named.namedShare * 100).toFixed(0)}% · ${named.verdict}`
    );
    if (named.sheetCheck) {
      console.debug(
        `[race] sheet check ${named.sheetCheck.laps} laps · median ${named.sheetCheck.medianMs.toFixed(0)}ms worst ${named.sheetCheck.worstMs.toFixed(0)}ms`
      );
    }
    // How much of a lap the car was actually seen for. A lap named from two crossings but seen in
    // a tenth of its frames has no path worth reading, and that is a different fault from a lap
    // whose path is there and simply misses a line.
    {
      const fps = 30;
      const covers = named.laps
        .map((l) => l.points.length / Math.max(1, Math.round((l.endSec - l.startSec) * fps)))
        .sort((a, b) => a - b);
      console.debug(
        `[race] lap coverage median ${((covers[covers.length >> 1] ?? 0) * 100).toFixed(0)}% · worst ${((covers[0] ?? 0) * 100).toFixed(0)}% · best ${((covers[covers.length - 1] ?? 0) * 100).toFixed(0)}% · whole-path laps ${named.laps.filter((l) => l.pathComplete).length}/${named.laps.length}`
      );
    }

    report(0.98, "Reading the sectors…");
    const sectors = sectorCrossings({
      laps: named.laps,
      lines: cornerLines,
      frameW,
      frameH,
      candidatesByLine,
      carPx,
    });
    // The same shape the crossing scan prints, so one grader reads both passes.
    for (const c of sectors.crossings) {
      console.debug(
        `[review] ${c.unsure || c.surprise ? "suspect" : "found"} ${c.role ?? c.key} L${c.lapNumber} ${c.lineKey} ${c.t.toFixed(3)} ${c.source}${c.unsure ? " unsure" : ""}${c.surprise ? " surprise" : ""}`
      );
    }
    for (const m of sectors.missing) {
      console.debug(
        `[review] missing ${m.role ?? m.key} L${m.lapNumber} ${m.lineKey} in ${m.fromSec.toFixed(2)}–${m.toSec.toFixed(2)} · nearest ${m.nearestCarLengths == null ? "no path" : m.nearestCarLengths.toFixed(1) + " car lengths"}`
      );
    }

    const pieces = toSession({
      sessionId: opts.sessionId,
      frameW,
      frameH,
      named,
      sectors,
      linked,
      sfKey,
      cornerKeys: cornerLines.map((l) => l.lineKey),
      seatedRoles: opts.seatedRoles,
      span: { fromSec: span.fromSec, toSec: span.toSec },
      frames: framesRead,
      readMs,
      scale: divisor,
      shakeFrames: detector.shakeFrames,
    });

    report(1, "Done.");
    return {
      pieces,
      named,
      sectors,
      linked,
      reader: source.kind,
      starved,
      elapsedMs: performance.now() - startedAt,
      framesRead,
      calibration: { mode, byLine },
      dump: {
        at: new Date().toISOString(),
        frameW,
        frameH,
        scale: divisor,
        carPx,
        sfKey,
        lines,
        sheet,
        seatedRoles: [...opts.seatedRoles],
        spans,
        frames,
        strip: Object.fromEntries(candidatesByLine),
      },
    };
  } finally {
    await source.close();
  }
}

/** Brightness from RGBA, kept here so a caller outside the class can use the same weights. */
export function lumaWeights(): readonly [number, number, number] {
  return LUMA_WEIGHTS;
}
