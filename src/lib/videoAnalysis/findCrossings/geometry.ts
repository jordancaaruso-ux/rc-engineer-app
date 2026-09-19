/**
 * Line geometry for crossing detection: where to decode, and which pixels count.
 *
 * Three different extents, deliberately:
 *   - the ROI (what gets decoded) runs half a line-length past each end with a fat pad;
 *   - the band (which pixels the detector looks at) is a thin strip a little past each end;
 *   - `crossedOnLine` (which flips are allowed to count) is the drawn segment itself.
 * Widening the ROI costs decode time. Widening the band lets a car on the neighbouring piece of
 * track be watched. Only the third one decides whether it becomes a crossing.
 */

import type { DetectorParams, Roi, SectorLine } from "./types";
import { ROI_LINE_EXTEND, ROI_PAD_FRAC } from "./types";

export type LineGeom = {
  p1x: number;
  p1y: number;
  dx: number;
  dy: number;
  /** Line length in pixels. */
  norm: number;
};

/** Line endpoints and direction in full-frame pixel coords. */
export function lineGeom(line: SectorLine, frameW: number, frameH: number): LineGeom {
  const p1x = line.x1 * frameW;
  const p1y = line.y1 * frameH;
  const p2x = line.x2 * frameW;
  const p2y = line.y2 * frameH;
  const dx = p2x - p1x;
  const dy = p2y - p1y;
  return { p1x, p1y, dx, dy, norm: Math.hypot(dx, dy) };
}

/**
 * Signed perpendicular distance from a full-frame point to the line, in pixels.
 * Sign is what the whole detector rests on: a car crossing flips it.
 */
export function signedDistance(g: LineGeom, x: number, y: number): number {
  return (g.dx * (y - g.p1y) - g.dy * (x - g.p1x)) / g.norm;
}

/** Position along the line, 0 at p1 and 1 at p2. */
export function alongLine(g: LineGeom, x: number, y: number): number {
  return ((x - g.p1x) * g.dx + (y - g.p1y) * g.dy) / (g.norm * g.norm);
}

/**
 * The crop rectangle to decode for this line. Matches the offline probe exactly —
 * `int()` truncation included, since the band mask is indexed off these origins.
 */
export function roiFor(line: SectorLine, frameW: number, frameH: number): Roi {
  const g = lineGeom(line, frameW, frameH);
  const p2x = g.p1x + g.dx;
  const p2y = g.p1y + g.dy;
  const p1ex = g.p1x - g.dx * ROI_LINE_EXTEND;
  const p1ey = g.p1y - g.dy * ROI_LINE_EXTEND;
  const p2ex = p2x + g.dx * ROI_LINE_EXTEND;
  const p2ey = p2y + g.dy * ROI_LINE_EXTEND;
  const pad = Math.max(40, Math.trunc(frameW * ROI_PAD_FRAC));
  return {
    x0: Math.trunc(Math.max(0, Math.min(p1ex, p2ex) - pad)),
    y0: Math.trunc(Math.max(0, Math.min(p1ey, p2ey) - pad)),
    x1: Math.trunc(Math.min(frameW, Math.max(p1ex, p2ex) + pad)),
    y1: Math.trunc(Math.min(frameH, Math.max(p1ey, p2ey) + pad)),
  };
}

/** The knobs that decide the band's shape — everything that reads it takes only these. */
export type BandParams = Pick<
  DetectorParams,
  "bandFrac" | "extend" | "endCapBands" | "bandLineFrac" | "minBandPx"
>;

/** No line is watched thinner than this: below it there are too few pixels to blur or blob. */
export const MIN_BAND_HALF_PX = 20;

/**
 * Half the band's thickness, in full-frame pixels.
 *
 * `bandFrac` alone is one pixel count for the whole picture. That is a car's width on the near
 * straight and, at the far end of the track where there are a fraction of the pixels per metre,
 * both directions of a hairpin. `bandLineFrac` caps it against the line's OWN length, which is
 * the local scale: a line is drawn across the track, and track width barely changes.
 */
export function bandHalfPxFor(g: LineGeom, frameW: number, params: BandParams): number {
  const byFrame = Math.trunc(frameW * params.bandFrac);
  const byLine = params.bandLineFrac ? Math.trunc(g.norm * params.bandLineFrac) : Infinity;
  return Math.max(params.minBandPx ?? MIN_BAND_HALF_PX, Math.min(byFrame, byLine));
}

/**
 * Lines at least this long, in frame pixels, take the full 5-tap blur; from the second figure
 * up, the 3-tap; below it, none.
 *
 * The blur exists to keep sensor noise out of the motion mask, and it costs nothing on a car
 * thirty pixels long. On a car four pixels long it costs most of the signal: measured at Bendigo
 * S1 (a 9px line, 1080p, 2026-09-02) a pass that reads 15–24 levels raw reads 6–10 after the
 * 5-tap, straddling the gate — one car seen on 8 laps of 10, the other never. A car is a fixed
 * fraction of the track's width, and the line is drawn across the track, so the line's own
 * pixel length is the car's scale; the kernel is chosen to stay well under it.
 */
export const BLUR_FULL_MIN_LINE_PX = 40;
export const BLUR_LIGHT_MIN_LINE_PX = 16;

export function blurKernelFor(g: LineGeom, params: { blur: number; blurByLine?: boolean }): 1 | 3 | 5 {
  const max = params.blur >= 5 ? 5 : params.blur >= 3 ? 3 : 1;
  if (!params.blurByLine) return max;
  if (g.norm >= BLUR_FULL_MIN_LINE_PX) return max;
  if (g.norm >= BLUR_LIGHT_MIN_LINE_PX) return max === 5 ? 3 : max;
  return 1;
}

/** The same, from a stored line — for callers calibrating before they have a scanner. */
export function blurKernelForLine(
  line: SectorLine,
  frameW: number,
  frameH: number,
  params: { blur: number; blurByLine?: boolean }
): 1 | 3 | 5 {
  return blurKernelFor(lineGeom(line, frameW, frameH), params);
}

/**
 * Did this crossing land on the line the driver drew?
 *
 * The sign test that finds a crossing runs against the INFINITE line, so on its own it cannot
 * tell your corner from the return lane of the same hairpin — both flip sides. The band's shape
 * was the only thing bounding that, and a band is a blurry instrument. This is the sharp one:
 * where the car actually was when it changed sides. Slack is in band widths, because the thing
 * being placed is a blob centre and a car straddling the end sits about half a car past it.
 */
export function crossedOnLine(
  g: LineGeom,
  frameW: number,
  params: BandParams & Pick<DetectorParams, "onLineSlackBands">,
  x: number | undefined,
  y: number | undefined
): boolean {
  if (params.onLineSlackBands == null) return true;
  if (x == null || y == null) return true;
  const slack = (bandHalfPxFor(g, frameW, params) * params.onLineSlackBands) / g.norm;
  const along = alongLine(g, x, y);
  return along >= -slack && along <= 1 + slack;
}

/**
 * Binary mask over the ROI marking pixels close enough to the line to count.
 * 1 = inside the band, 0 = ignore. Built once per (line, roi, params) and reused
 * for every frame — it is pure geometry, nothing to do with the picture.
 */
export function bandMask(
  line: SectorLine,
  roi: Roi,
  frameW: number,
  frameH: number,
  params: BandParams
): Uint8Array {
  const g = lineGeom(line, frameW, frameH);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const band = bandHalfPxFor(g, frameW, params);
  // A capsule, not a rectangle: the band runs one band-width (about a car length) past each end
  // of the line, plus whatever fraction `extend` asks for. A car that reaches the line at its
  // very tip — the far end of a fisheye shot, where the cars hug one edge and a drawn line only
  // just reaches them (Test A3 S1, 2026-08-29) — is then seen on BOTH sides of the line, which
  // is what a crossing is. Measured in pixels so a short line stays short: the old 35% of the
  // line's length was nothing on a long line and, on that 100px S1, reached the return lane of
  // the hairpin beside it and read the wrong piece of track.
  const capPx = band * (params.endCapBands ?? 1);
  const lo = -params.extend - capPx / g.norm;
  const hi = 1 + params.extend + capPx / g.norm;

  const mask = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const y = roi.y0 + row;
    for (let col = 0; col < w; col++) {
      const x = roi.x0 + col;
      const signed = signedDistance(g, x, y);
      if (Math.abs(signed) > band) continue;
      const along = alongLine(g, x, y);
      if (along < lo || along > hi) continue;
      mask[row * w + col] = 1;
    }
  }
  return mask;
}
