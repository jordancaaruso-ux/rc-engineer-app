import type { CSSProperties } from "react";
import type { VideoViewCropNorm } from "./types";

export type { VideoViewCropNorm };

export const VIDEO_FRAME_ASPECT = 16 / 9;
const MIN_CROP_FRACTION = 0.05;

export function parseViewCropNorm(raw: unknown): VideoViewCropNorm | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.x !== "number" ||
    typeof o.y !== "number" ||
    typeof o.w !== "number" ||
    typeof o.h !== "number"
  ) {
    return undefined;
  }
  return clampViewCropNorm({ x: o.x, y: o.y, w: o.w, h: o.h }) ?? undefined;
}

export function clampViewCropNorm(
  raw: Partial<VideoViewCropNorm>
): VideoViewCropNorm | null {
  let x = Number(raw.x);
  let y = Number(raw.y);
  let w = Number(raw.w);
  let h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;

  w = Math.max(MIN_CROP_FRACTION, Math.min(1, w));
  h = Math.max(MIN_CROP_FRACTION, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}

export function rectFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  square: boolean
): VideoViewCropNorm | null {
  let x1 = Math.min(ax, bx);
  let x2 = Math.max(ax, bx);
  let y1 = Math.min(ay, by);
  let y2 = Math.max(ay, by);
  let w = x2 - x1;
  let h = y2 - y1;

  if (square) {
    const side = Math.max(w, h);
    if (bx >= ax && by >= ay) {
      x1 = ax;
      y1 = ay;
    } else if (bx < ax && by >= ay) {
      x1 = ax - side;
      y1 = ay;
    } else if (bx >= ax && by < ay) {
      x1 = ax;
      y1 = ay - side;
    } else {
      x1 = ax - side;
      y1 = ay - side;
    }
    w = side;
    h = side;
  }

  return clampViewCropNorm({ x: x1, y: y1, w, h });
}

export function cropDisplayAspectRatio(crop: VideoViewCropNorm): string {
  return `${crop.w * 16} / ${crop.h * 9}`;
}

/** Zoom/pan inner stage so `crop` fills the outer viewport. */
export function cropFrameInnerStyle(crop: VideoViewCropNorm): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    transform: `translate(${(-crop.x / crop.w) * 100}%, ${(-crop.y / crop.h) * 100}%)`,
  };
}
