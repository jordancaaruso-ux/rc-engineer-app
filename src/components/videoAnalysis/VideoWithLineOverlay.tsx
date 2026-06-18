"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoViewCropNorm } from "@/lib/manualVideoAnalysis/types";
import {
  appliedVideoCropStyle,
  VIDEO_FRAME_ASPECT,
  videoContentRectInContainer,
} from "@/lib/manualVideoAnalysis/videoViewCrop";
import { VideoCropFrame } from "./VideoCropFrame";
import { VideoCropSelector } from "./VideoCropSelector";
import type { SectorLineNorm } from "./SectorLineCanvas";

type Props = {
  videoSrc: string | null;
  lines: SectorLineNorm[];
  activeLineKey?: string | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Applied crop — zooms the frame to this region. */
  viewCropNorm?: VideoViewCropNorm | null;
  /** When true, show snipping selector on the full uncropped frame. */
  cropSelectMode?: boolean;
  draftCrop?: VideoViewCropNorm | null;
  onDraftCropChange?: (crop: VideoViewCropNorm | null) => void;
  /** Hide native video controls while drawing a crop. */
  hideControls?: boolean;
};

function SectorLinesOverlay({
  lines,
  activeLineKey,
  size,
}: {
  lines: SectorLineNorm[];
  activeLineKey?: string | null;
  size: { w: number; h: number };
}) {
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none z-10"
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
    >
      {lines.map((ln) => {
        const active = ln.lineKey === activeLineKey;
        const color = ln.lineKey === "sf" ? "#22c55e" : active ? "#f97316" : "#60a5fa";
        const x1 = ln.x1 * size.w;
        const y1 = ln.y1 * size.h;
        const x2 = ln.x2 * size.w;
        const y2 = ln.y2 * size.h;
        return (
          <line
            key={ln.lineKey}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={active ? 3 : 2}
            strokeDasharray={ln.lineKey === "sf" ? undefined : "6 4"}
          />
        );
      })}
    </svg>
  );
}

export function VideoWithLineOverlay({
  videoSrc,
  lines,
  activeLineKey,
  videoRef: externalRef,
  viewCropNorm = null,
  cropSelectMode = false,
  draftCrop = null,
  onDraftCropChange,
  hideControls = false,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef ?? internalRef;
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [videoAspect, setVideoAspect] = useState(VIDEO_FRAME_ASPECT);

  const displayCrop = cropSelectMode ? null : viewCropNorm;
  const contentRect = videoContentRectInContainer(VIDEO_FRAME_ASPECT, videoAspect);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;
    const syncAspect = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setVideoAspect(v.videoWidth / v.videoHeight);
      }
    };
    syncAspect();
    v.addEventListener("loadedmetadata", syncAspect);
    return () => v.removeEventListener("loadedmetadata", syncAspect);
  }, [videoRef, videoSrc]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(180, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [displayCrop]);

  return (
    <VideoCropFrame crop={displayCrop} videoAspect={videoAspect}>
      <div ref={stageRef} className="absolute inset-0">
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className={
              displayCrop
                ? "absolute"
                : "absolute inset-0 h-full w-full object-contain"
            }
            style={displayCrop ? appliedVideoCropStyle(displayCrop) : undefined}
            controls={!hideControls && !cropSelectMode}
            playsInline
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Select a video file
          </div>
        )}
        <SectorLinesOverlay lines={lines} activeLineKey={activeLineKey} size={size} />
        {cropSelectMode && onDraftCropChange ? (
          <VideoCropSelector
            value={draftCrop}
            onChange={onDraftCropChange}
            contentRect={contentRect}
            disabled={!videoSrc}
          />
        ) : null}
      </div>
    </VideoCropFrame>
  );
}

export function useVideoCurrentTime(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setT(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoRef]);
  return t;
}
