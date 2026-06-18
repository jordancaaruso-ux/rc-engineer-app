"use client";

import type { ReactNode } from "react";
import {
  cropDisplayAspectRatio,
  cropFrameInnerStyle,
  type VideoViewCropNorm,
} from "@/lib/manualVideoAnalysis/videoViewCrop";

type Props = {
  crop?: VideoViewCropNorm | null;
  children: ReactNode;
  className?: string;
  rounded?: boolean;
};

export function VideoCropFrame({ crop, children, className = "", rounded = true }: Props) {
  const round = rounded ? "rounded-lg" : "";
  if (!crop) {
    return (
      <div
        className={`relative w-full overflow-hidden bg-black border border-border ${round} ${className}`}
        style={{ aspectRatio: "16 / 9" }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden bg-black border border-border ${round} ${className}`}
      style={{ aspectRatio: cropDisplayAspectRatio(crop) }}
    >
      <div style={cropFrameInnerStyle(crop)}>
        <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
