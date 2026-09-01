/**
 * Line geometry for crossing detection: where to decode, and which pixels count.
 *
 * Two different extents, deliberately: the ROI (what gets decoded) runs half a line-length
 * past each end with a fat pad, while the band (what the detector believes) is a thin strip
 * that runs only `extend` past each end. Widening the ROI costs decode time; widening the
 * band lets a car on the neighbouring piece of track register as a crossing.
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
  params: Pick<DetectorParams, "bandFrac" | "extend">
): Uint8Array {
  const g = lineGeom(line, frameW, frameH);
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const band = Math.max(20, Math.trunc(frameW * params.bandFrac));
  // A capsule, not a rectangle: the band runs one band-width (about a car length) past each end
  // of the line, plus whatever fraction `extend` asks for. A car that reaches the line at its
  // very tip — the far end of a fisheye shot, where the cars hug one edge and a drawn line only
  // just reaches them (Test A3 S1, 2026-08-29) — is then seen on BOTH sides of the line, which
  // is what a crossing is. Measured in pixels so a short line stays short: the old 35% of the
  // line's length was nothing on a long line and, on that 100px S1, reached the return lane of
  // the hairpin beside it and read the wrong piece of track.
  const capPx = band;
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
