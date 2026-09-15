"use client";

/**
 * What does reading the WHOLE frame cost, per frame, in this browser?
 *
 * Step 0 of `docs/VIDEO_RACE_PASS_PLAN.md`, and it gates every later piece. The crossing scan
 * reads a few hundred pixels a frame out of a thin strip along each line; the race pass has to
 * read the whole track area to find every moving thing. Nobody had measured what that costs.
 *
 * Two known traps, both re-proved here:
 *
 *  - **Never `willReadFrequently`.** It moves the canvas to CPU storage and every draw of a 4K
 *    HDR frame becomes a software conversion — 93.8 ms against 0.2 ms (2026-08-26).
 *  - **One reader per decode pass.** The first cut of this rig timed three readers inside one
 *    pass and reported 13.9 ms for the quarter-scale read. Alone it is 3.2 ms. `getImageData`
 *    stalls the pipeline, so several readbacks a frame queue behind one another and every number
 *    comes out four times too big. That measurement nearly bought a WebGL detour nothing needed.
 *
 * So the rig is in two halves. **The read** is timed one way per decode pass, nothing else in the
 * loop. **The pixel work** — what turns a coarse picture into blobs — is timed as a set of
 * recipes over the same frames, because it is all CPU and does not stall on anything.
 *
 * The recipes exist because the obvious one is far too slow (44.7 ms a frame) and the reasons are
 * each worth a number:
 *
 *  - **Four channels or one.** The crossing scan already reads brightness on nearly every line
 *    (`calibrate.ts`), and the blur and the difference both cost per channel.
 *  - **Blur, or the downscale.** `drawImage` into a smaller canvas box-filters on the way down,
 *    which is what a blur is for. If that is enough, a whole pass disappears — but the guard is
 *    the blob count: grain firing is the death spiral that emptied three sectors in September,
 *    so a recipe that finds twenty times the blobs is wrong however fast it is.
 *  - **Where to dilate.** Spreading the mask costs the same everywhere by default, and on this
 *    footage four hundredths of one per cent of the frame moves. Row spans taken from the mask
 *    itself confine it to the part that did.
 *
 * **The gate is decode pace.** The lap tracer measured ~25 ms a frame end to end at 4K, of which
 * its own small-window read was 7.6 ms, so decoding is 15–20 ms. Per-frame work at or under
 * 15 ms keeps the pass decode-bound, which is the whole cost claim in the plan.
 *
 * Nothing is uploaded and nothing is saved.
 */

import { useRef, useState } from "react";
import { notFound } from "next/navigation";

import { openFrameSource, type FrameImage, type FrameSource } from "@/lib/videoAnalysis/findCrossings/frameSource";
import { blurFrame, diffWindowBg, dilate5, findBlobs } from "@/lib/videoAnalysis/findCrossings/imageOps";
import { expandSpans, spansFromMask, type RowSpans } from "@/lib/videoAnalysis/findCrossings/spans";
import { medianBackground } from "@/lib/videoAnalysis/trace/background";
import { fullSpans } from "@/lib/videoAnalysis/trace/window";
import { CoarseDetector } from "@/lib/videoAnalysis/racePass/coarse";
import type { FrameCrop, Roi } from "@/lib/videoAnalysis/findCrossings/types";

/** Frames timed per pass. Enough that a median means something, short enough to wait for. */
const TIMED_FRAMES = 200;
/** Frames read and thrown away first: the first `drawImage` on a fresh canvas allocates. */
const WARMUP_FRAMES = 15;
/** Frames the still picture is built from, spread over the span. Odd, per `background.ts`. */
const BG_FRAMES = 9;
/** Stand-in gate for the pixel work. The real pass calibrates per line; the cost does not move. */
const THRESH = 10;
/** Stand-in car size for `minArea`, coarse pixels. */
const COARSE_CAR_PX = 6;
/** Rec.709, as `browserScan.ts` recovers brightness from RGBA. */
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

type Scale = "quarter" | "half" | "full" | "eighth";
const SCALE_OF: Record<Scale, number> = { eighth: 0.125, quarter: 0.25, half: 0.5, full: 1 };

type ReadResult = {
  scale: Scale;
  w: number;
  h: number;
  megapixels: number;
  median: number;
  p90: number;
};

type Recipe = {
  key: string;
  channels: 1 | 4;
  blur: boolean;
  dilateIterations: 1 | 2;
  maskSpans: boolean;
};

const RECIPES: Recipe[] = [
  { key: "rgba·blur·dil2·all", channels: 4, blur: true, dilateIterations: 2, maskSpans: false },
  { key: "luma·blur·dil2·all", channels: 1, blur: true, dilateIterations: 2, maskSpans: false },
  { key: "luma·flat·dil2·all", channels: 1, blur: false, dilateIterations: 2, maskSpans: false },
  { key: "luma·flat·dil2·mask", channels: 1, blur: false, dilateIterations: 2, maskSpans: true },
  { key: "luma·flat·dil1·mask", channels: 1, blur: false, dilateIterations: 1, maskSpans: true },
  { key: "luma·blur·dil1·mask", channels: 1, blur: true, dilateIterations: 1, maskSpans: true },
];

type WorkResult = {
  key: string;
  lumaMs: number;
  blurMs: number;
  diffMs: number;
  spansMs: number;
  dilateMs: number;
  blobsMs: number;
  totalMedian: number;
  totalP90: number;
  blobsPerFrame: number;
  movedShare: number;
};

type Report = {
  fileName: string;
  frameW: number;
  frameH: number;
  reader: string;
  reads: ReadResult[];
  work: WorkResult[];
  verdict: string;
  summary: string;
};

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Draw the frame down onto a GPU canvas and read the pixels back. */
class CanvasSource {
  readonly w: number;
  readonly h: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rgba: Uint8Array;

  constructor(scale: Scale, frameW: number, frameH: number) {
    const s = SCALE_OF[scale];
    this.w = Math.max(2, Math.round(frameW * s));
    this.h = Math.max(2, Math.round(frameH * s));
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("Could not open a 2D canvas.");
    this.ctx = ctx;
    this.rgba = new Uint8Array(this.w * this.h * 4);
  }

  read(image: FrameImage, frameW: number, frameH: number): FrameCrop {
    this.ctx.drawImage(image, 0, 0, frameW, frameH, 0, 0, this.w, this.h);
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    this.rgba.set(img.data);
    return { width: this.w, height: this.h, channels: 4, data: this.rgba };
  }
}

/** RGBA to one channel of brightness, the way `browserScan.ts` does it. */
function toLuma(src: FrameCrop, out: Uint8Array): FrameCrop {
  const [wr, wg, wb] = LUMA_WEIGHTS;
  const n = src.width * src.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    out[p] = (src.data[i]! * wr + src.data[i + 1]! * wg + src.data[i + 2]! * wb + 0.5) | 0;
  }
  return { width: src.width, height: src.height, channels: 1, data: out };
}

/** One way of turning a coarse picture into blobs, timed stage by stage. */
class Work {
  private readonly spansAll: RowSpans;
  private readonly blurScratch: { horiz: Int32Array; out: Uint8Array };
  private readonly mask: Uint8Array;
  private readonly dil: { a: Uint8Array; b: Uint8Array; horiz: Uint8Array };
  private readonly seen: Uint8Array;
  private readonly stack: Int32Array;
  private readonly support: Uint8Array;
  private readonly lumaBuf: Uint8Array;
  private readonly prevBuf: Uint8Array;
  private prev: FrameCrop | null = null;
  private readonly roi: Roi;
  private readonly bg: FrameCrop;
  private readonly minArea: number;
  readonly lumaMs: number[] = [];
  readonly blurMs: number[] = [];
  readonly diffMs: number[] = [];
  readonly spansMs: number[] = [];
  readonly dilateMs: number[] = [];
  readonly blobsMs: number[] = [];
  readonly blobCounts: number[] = [];
  readonly movedShares: number[] = [];

  constructor(
    readonly recipe: Recipe,
    private readonly w: number,
    private readonly h: number,
    bgRgba: FrameCrop
  ) {
    const px = w * h;
    const bytes = px * recipe.channels;
    this.spansAll = fullSpans(w, h);
    this.blurScratch = { horiz: new Int32Array(bytes), out: new Uint8Array(bytes) };
    this.mask = new Uint8Array(px);
    this.dil = { a: new Uint8Array(px), b: new Uint8Array(px), horiz: new Uint8Array(px) };
    this.seen = new Uint8Array(px);
    this.stack = new Int32Array(px);
    this.support = new Uint8Array(px);
    this.lumaBuf = new Uint8Array(px);
    this.prevBuf = new Uint8Array(bytes);
    this.roi = { x0: 0, y0: 0, x1: w, y1: h };
    this.minArea = Math.max(3, 12 * (COARSE_CAR_PX / 20) ** 2);
    // The still picture is built once in RGBA; a one-channel recipe needs its own copy.
    if (recipe.channels === 1) {
      const out = new Uint8Array(px);
      this.bg = toLuma(bgRgba, out);
    } else {
      this.bg = bgRgba;
    }
  }

  push(rgba: FrameCrop, timed: boolean): void {
    const t0 = performance.now();
    const src = this.recipe.channels === 1 ? toLuma(rgba, this.lumaBuf) : rgba;
    const t1 = performance.now();
    const blurred = this.recipe.blur
      ? blurFrame(src, 3, this.spansAll, this.spansAll, this.blurScratch)
      : src;
    const t2 = performance.now();
    const moved = diffWindowBg(
      this.prev,
      this.prev ? this.roi : null,
      this.bg,
      blurred,
      this.roi,
      THRESH,
      this.mask,
      0
    );
    this.support.set(this.mask);
    const t3 = performance.now();
    // Where to spread. The mask's own rows, grown by the reach of each pass, or everywhere.
    const iterations = this.recipe.dilateIterations;
    let dilateSpans: RowSpans[];
    if (this.recipe.maskSpans) {
      const base = spansFromMask(this.mask, this.w, this.h);
      dilateSpans = Array.from({ length: iterations }, (_, i) => expandSpans(base, 2 * (i + 1)));
    } else {
      dilateSpans = Array.from({ length: iterations }, () => this.spansAll);
    }
    const t4 = performance.now();
    const grown = dilate5(this.mask, this.w, this.h, dilateSpans, this.dil);
    const t5 = performance.now();
    const blobs = findBlobs(
      grown,
      this.w,
      this.h,
      this.minArea,
      dilateSpans[iterations - 1]!,
      this.seen,
      this.stack,
      this.support
    );
    const t6 = performance.now();

    if (timed) {
      this.lumaMs.push(t1 - t0);
      this.blurMs.push(t2 - t1);
      this.diffMs.push(t3 - t2);
      this.spansMs.push(t4 - t3);
      this.dilateMs.push(t5 - t4);
      this.blobsMs.push(t6 - t5);
      this.blobCounts.push(blobs.length);
      this.movedShares.push(moved / (this.w * this.h));
    }
    // The frame just read becomes the reference for the next one. It must be copied: both the
    // luma buffer and the blur's output are reused on the very next frame.
    this.prevBuf.set(blurred.data.subarray(0, this.w * this.h * this.recipe.channels));
    this.prev = { width: this.w, height: this.h, channels: this.recipe.channels, data: this.prevBuf };
  }

  result(): WorkResult {
    const totals = this.lumaMs.map(
      (v, i) =>
        v +
        (this.blurMs[i] ?? 0) +
        (this.diffMs[i] ?? 0) +
        (this.spansMs[i] ?? 0) +
        (this.dilateMs[i] ?? 0) +
        (this.blobsMs[i] ?? 0)
    );
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    return {
      key: this.recipe.key,
      lumaMs: median(this.lumaMs),
      blurMs: median(this.blurMs),
      diffMs: median(this.diffMs),
      spansMs: median(this.spansMs),
      dilateMs: median(this.dilateMs),
      blobsMs: median(this.blobsMs),
      totalMedian: median(totals),
      totalP90: quantile(totals, 0.9),
      blobsPerFrame: mean(this.blobCounts),
      movedShare: mean(this.movedShares),
    };
  }
}

export default function RaceReadPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState("Pick a video. Nothing is uploaded and nothing is saved.");
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);

  async function run(file: File) {
    setRunning(true);
    setReport(null);
    setLog([]);
    const say = (s: string) => {
      console.debug(`[raceread] ${s}`);
      setLog((p) => [...p, s]);
    };

    const video = videoRef.current!;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let source: FrameSource | null = null;

    try {
      setStatus("Reading the file header…");
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("Could not open this video."));
      });
      const frameW = video.videoWidth;
      const frameH = video.videoHeight;
      const duration = video.duration;
      say(`${file.name} · ${frameW}×${frameH} · ${Math.round(duration)}s · ${(file.size / 1e9).toFixed(2)}GB`);

      source = await openFrameSource(video, file);
      say(`reader ${source.kind} · ${source.label}`);
      if (source.kind !== "decoded") {
        say("WARNING: the player reader paces itself to playback — these numbers are not the decoder's.");
      }

      const fps = 30;
      const span = (TIMED_FRAMES + WARMUP_FRAMES) / fps;
      const from = Math.max(0, Math.min(duration * 0.4, duration - span - 1));
      const to = from + span;

      // Half one: the read, one scale per decode pass and nothing else in the loop.
      const scales: Scale[] = ["eighth", "quarter", "half", "full"];
      const reads: ReadResult[] = [];
      for (const scale of scales) {
        setStatus(`Timing the ${scale}-scale read…`);
        const src = new CanvasSource(scale, frameW, frameH);
        const times: number[] = [];
        let n = 0;
        await source.readRange(from, to, 1, (image, _t) => {
          const t0 = performance.now();
          src.read(image, frameW, frameH);
          const t1 = performance.now();
          if (n >= WARMUP_FRAMES) times.push(t1 - t0);
          n++;
        });
        const r: ReadResult = {
          scale,
          w: src.w,
          h: src.h,
          megapixels: (src.w * src.h) / 1e6,
          median: median(times),
          p90: quantile(times, 0.9),
        };
        reads.push(r);
        say(
          `read ${scale.padEnd(7)} ${r.w}×${r.h} (${r.megapixels.toFixed(2)}MP) · ${r.median.toFixed(2)}ms median, ${r.p90.toFixed(2)}ms p90`
        );
      }

      // Half two: the pixel work, every recipe over the same quarter-scale frames.
      setStatus("Building a still picture of the empty track…");
      const coarse = new CanvasSource("quarter", frameW, frameH);
      const keep: FrameCrop[] = [];
      const every = Math.max(1, Math.floor((TIMED_FRAMES + WARMUP_FRAMES) / BG_FRAMES));
      let seen = 0;
      await source.readRange(from, to, 1, (image, _t) => {
        if (seen++ % every !== 0 || keep.length >= BG_FRAMES) return;
        const crop = coarse.read(image, frameW, frameH);
        keep.push({
          width: crop.width,
          height: crop.height,
          channels: 4,
          data: new Uint8Array(crop.data.subarray(0, crop.width * crop.height * 4)),
        });
      });
      const bg = medianBackground(keep);
      if (!bg) throw new Error("Could not build a still picture.");
      say(`still picture from ${keep.length} frames at ${bg.width}×${bg.height}`);

      setStatus("Timing the pixel work…");
      const works = RECIPES.map((r) => new Work(r, coarse.w, coarse.h, bg));
      let n = 0;
      await source.readRange(from, to, 1, (image, _t) => {
        const crop = coarse.read(image, frameW, frameH);
        const timed = n >= WARMUP_FRAMES;
        for (const w of works) w.push(crop, timed);
        n++;
      });
      // And the real thing: `CoarseDetector`, which is the winning recipe with its two hot loops
      // written out for one channel over a fixed whole frame. This is the number that decides the
      // build; everything above it is the reasoning that got here.
      setStatus("Timing the race pass's own detector…");
      const det = new CoarseDetector({ w: coarse.w, h: coarse.h, divisor: 4, thresh: THRESH, carPx: COARSE_CAR_PX });
      det.setBackground(bg);
      const detTimes: number[] = [];
      const detBlobs: number[] = [];
      let dn = 0;
      await source.readRange(from, to, 1, (image, t) => {
        const crop = coarse.read(image, frameW, frameH);
        const t0 = performance.now();
        const frame = det.push(crop, t);
        const t1 = performance.now();
        if (dn >= WARMUP_FRAMES) {
          detTimes.push(t1 - t0);
          detBlobs.push(frame.blobs.length);
        }
        dn++;
      });
      const detMedian = median(detTimes);
      const detMean = detBlobs.length ? detBlobs.reduce((a, b) => a + b, 0) / detBlobs.length : NaN;
      say(
        `work ${"CoarseDetector".padEnd(20)} TOTAL ${detMedian.toFixed(2)}ms p90 ${quantile(detTimes, 0.9).toFixed(2)} · ${detMean.toFixed(1)} blobs/frame · shake ${det.shakeFrames} crowded ${det.crowdedFrames}`
      );

      const workResults = works.map((w) => w.result());
      for (const r of workResults) {
        say(
          `work ${r.key.padEnd(20)} luma ${r.lumaMs.toFixed(2)} blur ${r.blurMs.toFixed(2)} diff ${r.diffMs.toFixed(2)} spans ${r.spansMs.toFixed(2)} dilate ${r.dilateMs.toFixed(2)} blobs ${r.blobsMs.toFixed(2)} · TOTAL ${r.totalMedian.toFixed(2)}ms p90 ${r.totalP90.toFixed(2)} · ${r.blobsPerFrame.toFixed(1)} blobs/frame · ${(r.movedShare * 100).toFixed(3)}% moved`
        );
      }

      // The baseline's blob count is what every faster recipe has to stay near: a recipe that
      // finds many times more is finding grain, which is the failure that emptied three sectors
      // in September, not a speed-up.
      const base = workResults[0]!;
      const quarter = reads.find((r) => r.scale === "quarter")!;
      const total = quarter.median + detMedian;
      // The baseline's blob count is what the fast path has to stay near: finding many times more
      // is finding grain, which is the failure that emptied three sectors in September.
      const grainOk = detMean <= base.blobsPerFrame * 2 + 2;
      const verdict = !grainOk ? "GRAIN" : total <= 15 ? "PASS quarter" : "OVER quarter";
      const summary = !grainOk
        ? `The detector finds ${detMean.toFixed(1)} blobs a frame against the baseline's ${base.blobsPerFrame.toFixed(1)} — that is grain, not speed.`
        : `quarter-scale read ${quarter.median.toFixed(1)}ms + CoarseDetector ${detMedian.toFixed(1)}ms = ${total.toFixed(1)}ms a frame (gate 15ms). Blobs ${detMean.toFixed(1)} against the baseline's ${base.blobsPerFrame.toFixed(1)}.`;
      say(`VERDICT ${verdict} · ${summary}`);

      setReport({
        fileName: file.name,
        frameW,
        frameH,
        reader: source.kind,
        reads,
        work: workResults,
        verdict,
        summary,
      });
      setStatus("Done.");
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
      say(`FAILED ${(e as Error).message}`);
    } finally {
      await source?.close();
      URL.revokeObjectURL(url);
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="type-machine text-[13px] font-bold uppercase tracking-[0.1em]">Race pass — read cost</h1>

      <label className="inline-flex w-fit cursor-pointer items-center rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-ink">
        {running ? "Reading…" : "Pick a video"}
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={running}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f);
          }}
        />
      </label>

      <p className="text-[12px] text-muted-foreground">{status}</p>

      {report ? (
        <div
          className={
            "rounded-xl border p-4 " +
            (report.verdict.startsWith("PASS") ? "border-gain/40 bg-gain/5" : "border-destructive/40 bg-destructive/5")
          }
        >
          <p className="type-machine text-[20px] font-bold uppercase tracking-[0.1em]">{report.verdict}</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-foreground">{report.summary}</p>
        </div>
      ) : null}

      {log.length ? (
        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          {log.map((line, i) => (
            <p key={i} className="type-machine text-[10.5px] leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <video ref={videoRef} className="hidden" />
    </main>
  );
}
