"use client";

import type { ReactNode } from "react";
import {
  cropDisplayAspectRatio,
  VIDEO_FRAME_ASPECT,
  type VideoViewCropNorm,
} from "@/lib/manualVideoAnalysis/videoViewCrop";

type Props = {
  crop?: VideoViewCropNorm | null;
  /** Native video width / height — used for cropped viewport aspect. */
  videoAspect?: number;
  children: ReactNode;
  className?: string;
  rounded?: boolean;
};

export function VideoCropFrame({
  crop,
  videoAspect = VIDEO_FRAME_ASPECT,
  children,
  className = "",
  rounded = true,
}: Props) {
  const round = rounded ? "rounded-lg" : "";
  return (
    <div
      className={`relative w-full overflow-hidden bg-black border border-border ${round} ${className}`}
      style={{
        aspectRatio: crop ? cropDisplayAspectRatio(crop, videoAspect) : "16 / 9",
      }}
    >
      {children}
    </div>
  );
}
