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

export function cropDisplayAspectRatio(
  crop: VideoViewCropNorm,
  videoAspect = VIDEO_FRAME_ASPECT
): string {
  const cropAspect = (crop.w / crop.h) * videoAspect;
  return `${cropAspect} / 1`;
}

/** Letterboxed video content area inside a fixed-aspect container (object-contain). */
export type VideoContentRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function videoContentRectInContainer(
  containerAspect: number,
  videoAspect: number
): VideoContentRect {
  if (
    !Number.isFinite(containerAspect) ||
    containerAspect <= 0 ||
    !Number.isFinite(videoAspect) ||
    videoAspect <= 0
  ) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }

  if (videoAspect >= containerAspect) {
    const height = containerAspect / videoAspect;
    return { left: 0, top: (1 - height) / 2, width: 1, height };
  }

  const width = videoAspect / containerAspect;
  return { left: (1 - width) / 2, top: 0, width, height: 1 };
}

/** Map container-normalized coords to video-pixel-normalized coords. */
export function containerNormToVideoNorm(
  cx: number,
  cy: number,
  content: VideoContentRect
): { x: number; y: number } {
  if (content.width <= 0 || content.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, Math.min(1, (cx - content.left) / content.width)),
    y: Math.max(0, Math.min(1, (cy - content.top) / content.height)),
  };
}

/** Map video-pixel-normalized crop to container-normalized overlay coords. */
export function videoCropToContainerNorm(
  crop: VideoViewCropNorm,
  content: VideoContentRect
): VideoViewCropNorm {
  return {
    x: content.left + crop.x * content.width,
    y: content.top + crop.y * content.height,
    w: crop.w * content.width,
    h: crop.h * content.height,
  };
}

/** Position the video element so `crop` (video-normalized) fills the viewport. */
export function appliedVideoCropStyle(crop: VideoViewCropNorm): CSSProperties {
  return {
    position: "absolute",
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    objectFit: "fill",
    maxWidth: "none",
    maxHeight: "none",
  };
}
