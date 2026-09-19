/**
 * Work out how to read a given sector line, by measuring its band rather than assuming.
 *
 * The original recipe compares frames on the largest change across the three colour channels, and
 * calls anything above 14 "motion". Both were fitted to one line on one video, and colour turns
 * out to be the wrong channel for most lines on that same video.
 *
 * Colour is stored at quarter resolution and reconstructed on decode. Across the sharpest possible
 * colour edge — red-on-white kerb chevrons — that reconstruction wobbles every frame. Measured on
 * real footage, a band over those chevrons has 7.9% of its pixels crossing the motion threshold in
 * EVERY frame with a perfectly steady camera, and one band was 99.7% saturated. The same bands
 * read on brightness alone are still: nothing ever crosses the threshold. Grey tarmac has no colour
 * edge, which is why the two lines drawn on tarmac worked all along and the four on kerbs did not.
 *
 * ## Telling noise from traffic without needing a quiet moment
 *
 * The obvious calibration — watch the band when nothing is crossing it — fails in practice,
 * because on a busy heat there is almost always a car somewhere in the band, and a car reads as
 * enormous noise. Measured that way one band came back at 157 and earned a threshold of 707,
 * which detects nothing at all.
 *
 * The way through is that the two kinds of change look different across channels. A car changes
 * brightness and colour together, so its ratio is about 1. Colour reconstruction noise changes
 * only colour, so its ratio is large. Taking a high quantile of the per-frame ratio therefore
 * measures the noise even when every single frame contains traffic — the car frames simply sit at
 * the bottom of the distribution and never reach the quantile.
 */

import { blurFrame, type BlurKernel } from "./imageOps";
import { expandSpans, type RowSpans } from "./spans";
import type { DetectorParams, FrameCrop } from "./types";

/** Which channels the detector compares frames on. */
export type ChannelMode = "colour" | "luma";

export type BandNoise = {
  /** Inter-frame difference at the 99th percentile of band pixels, on the quietest frame seen. */
  quiet: number;
  /** Same statistic on a typical frame — includes traffic, so it is context, not a noise floor. */
  typical: number;
};

export type LineCalibration = {
  mode: ChannelMode;
  thresh: number;
  /** The blur the noise was measured under — the same one the detector must read with. */
  kernel: BlurKernel;
  colour: BandNoise | null;
  luma: BandNoise | null;
  /** How much noisier colour is than brightness, once traffic is discounted. */
  colourPenalty: number | null;
  /** Plain-language justification, for the trust line and for support questions. */
  reason: string;
};

/**
 * The threshold is measured, not fitted: a multiple of the band's own noise floor.
 *
 * It used to be clamped up to 14 reading colour and 9 reading brightness — the numbers the
 * original recipe converged on. Those were fitted with colour noise in the picture, and once the
 * channel choice removes it they are far too high: every corner band measures a brightness noise
 * floor of **1**, so 9 is nine times the noise. Measured on the far corner of this track, a gate
 * of 9 sees nothing at all as the car passes the line, and a gate of 6 sees it clearly. That is a
 * missed crossing caused purely by an inherited constant.
 *
 * Setting the gate low is only safe because motion coherence now does the rejecting — see
 * `tracks.ts`. A low gate lets more rubbish through, and rubbish does not move like a car. That
 * trade is much better than the reverse: a gate high enough to admit nothing but the car is also
 * high enough to miss the car.
 *
 * The floors below are NOT the sensor's noise floor, though they were first described that way.
 * After the 5-tap blur the sensor sits at 1–3 on this footage, and a gate of 3 was tried on
 * 2026-09-02: on IMG_4523 it moved S3 (a 188px line, a car thirty pixels long moving a car
 * length a frame) 33ms late on every hand-marked lap, and tripled S6's spread — because a gate
 * that low admits the smeared trailing edge of a fast car into its blob, and the blob's centre
 * drifts back along the trail. The floor is the lowest gate at which a big, fast car's blob
 * stays crisp, found by validation, and a distant car is not helped by lowering it: it is helped
 * by reading its line with less blur (`blurKernelFor`) and against the learnt background
 * (`motionMaskInBandBg`), which is where that work went.
 *
 * The noise is still measured under the blur the line is read with (`kernel`), so on a genuinely
 * noisy band — kerb chevrons, where colour reads 100+ — twice the measured noise is the number
 * that means something.
 */
const MIN_THRESH: Record<ChannelMode, number> = { colour: 8, luma: 5 };
/**
 * Signal must be twice the band's own noise floor. A flat margin was tried and is wrong: adding
 * 4 to a quiet band leaves a gate five times its noise (blind to a distant car), and adding 4 to
 * a busier one leaves a gate 1.6x its noise (start/finish crossings degraded from 2.5ms to 26ms
 * median against the transponder). Doubling holds at both ends.
 *
 * It also explains the original recipe's 14: the start/finish band measures a colour noise floor
 * of 7, and the offline probe converged on exactly twice it. The constant was a measurement of
 * one band all along.
 */
const NOISE_MULTIPLE = 2;
/**
 * Colour is kept unless it is materially noisier: catching a coloured car against
 * similar-brightness tarmac is exactly what comparing colour was introduced to do.
 */
const COLOUR_PENALTY_LIMIT = 1.6;
/** Quantile of the per-frame ratio taken as the verdict — high enough to skip traffic frames. */
const RATIO_QUANTILE = 0.8;

/**
 * Per-frame 99th-percentile band difference, one entry per consecutive pair — measured on the
 * frames as the detector will read them, i.e. after the same blur. Measuring the raw frames and
 * gating the blurred ones was how a floor meant to sit just above the sensor ended up two to
 * four times over it.
 */
export function bandFrameDiffs(
  frames: FrameCrop[],
  band: Uint8Array,
  spans: RowSpans,
  kernel: BlurKernel
): number[] {
  if (frames.length < 3) return [];
  const w = frames[0].width;
  const h = frames[0].height;
  const c = frames[0].channels;
  const colourCh = Math.min(3, c);
  const hist = new Uint32Array(256);
  const out: number[] = [];

  const horizSpans = expandSpans(spans, 2);
  const bytes = w * h * c;
  const scratch = [
    { horiz: new Int32Array(bytes), out: new Uint8Array(bytes) },
    { horiz: new Int32Array(bytes), out: new Uint8Array(bytes) },
  ];
  const blurred = frames.map((fr, i) => blurFrame(fr, kernel, spans, horizSpans, scratch[i % 2]!).data);

  for (let f = 1; f < frames.length; f++) {
    hist.fill(0);
    let n = 0;
    const a = blurred[f - 1]!;
    const b = blurred[f]!;
    for (let y = 0; y < spans.h; y++) {
      const from = spans.x0[y];
      const to = spans.x1[y];
      if (to <= from) continue;
      const rowPx = y * w;
      for (let x = from; x < to; x++) {
        if (!band[rowPx + x]) continue;
        const i = (rowPx + x) * c;
        let d = 0;
        for (let ch = 0; ch < colourCh; ch++) {
          const v = Math.abs(b[i + ch] - a[i + ch]);
          if (v > d) d = v;
        }
        hist[d]++;
        n++;
      }
    }
    if (!n) continue;
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v];
      if (cum >= n * 0.99) {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))];
}

function noiseFrom(diffs: number[]): BandNoise | null {
  if (!diffs.length) return null;
  return { quiet: quantile(diffs, 0.05), typical: quantile(diffs, 0.5) };
}

/**
 * Decide how to read one line from paired colour and brightness samples of the same frames.
 * The two arrays must line up frame for frame.
 */
export function calibrateFromDiffs(
  colourDiffs: number[],
  lumaDiffs: number[],
  kernel: BlurKernel = 5
): LineCalibration {
  const colour = noiseFrom(colourDiffs);
  const luma = noiseFrom(lumaDiffs);
  const n = Math.min(colourDiffs.length, lumaDiffs.length);
  const floor = MIN_THRESH;

  if (!colour || !luma || n < 3) {
    return {
      mode: "colour",
      thresh: floor.colour,
      kernel,
      colour,
      luma,
      colourPenalty: null,
      reason: "not enough sample to judge — reading colour",
    };
  }

  // Frame by frame: how much worse is colour than brightness? A car moves both and scores ~1;
  // colour reconstruction noise moves only colour and scores high. The upper end of this
  // distribution is the noise, whatever the traffic is doing.
  const ratios: number[] = [];
  for (let i = 0; i < n; i++) ratios.push(colourDiffs[i] / Math.max(1, lumaDiffs[i]));
  const colourPenalty = quantile(ratios, RATIO_QUANTILE);

  if (colourPenalty > COLOUR_PENALTY_LIMIT) {
    return {
      mode: "luma",
      thresh: Math.max(floor.luma, luma.quiet * NOISE_MULTIPLE),
      kernel,
      colour,
      luma,
      colourPenalty,
      reason:
        `colour is ${colourPenalty.toFixed(1)}x noisier than brightness here ` +
        "(painted markings) — reading brightness only",
    };
  }
  return {
    mode: "colour",
    thresh: Math.max(floor.colour, colour.quiet * NOISE_MULTIPLE),
    kernel,
    colour,
    luma,
    colourPenalty,
    reason: `colour is stable here (${colourPenalty.toFixed(1)}x) — reading colour`,
  };
}

/** The 5th-percentile band difference of one clip, or null when the clip is too short to say. */
function clipQuiet(diffs: number[]): number | null {
  return diffs.length >= 3 ? quantile(diffs, 0.05) : null;
}

/**
 * Calibrate from several short clips: the noise floor is the QUIETEST clip's, not the pooled
 * 5th percentile.
 *
 * Pooled, the browser's four clips spread across a Bendigo session (2026-09-02) measured S1 at
 * 22, S2 at 18 and S5 at 64 — the same lines the harness's single clip put at 8, 8 and 5.
 * Traffic and the phone being picked up at the end sat in enough of the pooled frames to lift
 * the 5th percentile, and a far car reading 15–24 then fell under its own gate on every lap.
 * A band's noise is what it does when nothing is happening, and one quiet clip is proof of
 * that however busy the others were. The colour-vs-brightness verdict still uses every frame:
 * its quantile is chosen to look past traffic.
 */
export function calibrateFromClips(
  colourClips: number[][],
  lumaClips: number[][],
  kernel: BlurKernel = 5
): LineCalibration {
  const base = calibrateFromDiffs(colourClips.flat(), lumaClips.flat(), kernel);
  const colourQuiets = colourClips.map(clipQuiet).filter((q): q is number => q != null);
  const lumaQuiets = lumaClips.map(clipQuiet).filter((q): q is number => q != null);
  if (!colourQuiets.length || !lumaQuiets.length || base.colourPenalty == null) return base;
  const colourQuiet = Math.min(...colourQuiets);
  const lumaQuiet = Math.min(...lumaQuiets);
  const thresh =
    base.mode === "luma"
      ? Math.max(MIN_THRESH.luma, lumaQuiet * NOISE_MULTIPLE)
      : Math.max(MIN_THRESH.colour, colourQuiet * NOISE_MULTIPLE);
  return {
    ...base,
    thresh,
    colour: base.colour ? { ...base.colour, quiet: colourQuiet } : base.colour,
    luma: base.luma ? { ...base.luma, quiet: lumaQuiet } : base.luma,
  };
}

/** Calibrate straight from decoded sample clips, under the blur the line will be read with. */
export function calibrateFromFrames(
  colourFrames: FrameCrop[],
  lumaFrames: FrameCrop[],
  band: Uint8Array,
  spans: RowSpans,
  kernel: BlurKernel
): LineCalibration {
  return calibrateFromDiffs(
    bandFrameDiffs(colourFrames, band, spans, kernel),
    bandFrameDiffs(lumaFrames, band, spans, kernel),
    kernel
  );
}

/** Apply a calibration on top of the base recipe. */
export function paramsFor(base: DetectorParams, cal: LineCalibration): DetectorParams {
  return { ...base, thresh: cal.thresh };
}
