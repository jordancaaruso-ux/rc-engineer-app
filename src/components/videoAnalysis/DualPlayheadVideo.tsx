"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import type { SectorLineNorm } from "./SectorLineCanvas";
import { VideoFrameControls } from "./VideoFrameControls";
import { useVideoOverlayFrameLockSync } from "@/components/videos/useVideoOverlayFrameLockSync";
import {
  pauseBoth,
  playBothSynced,
  seekBottomAndSync,
} from "@/components/videos/videoOverlayPlayback";
import { VideoViewTransform } from "./VideoViewTransform";

type Props = {
  videoSrc: string | null;
  lines: SectorLineNorm[];
  activeLineKey: string | null;
  /** Ghost (top) leads bottom by this many seconds — same video src, offset timeline. */
  offsetSec: number | null;
  bottomLabel?: string;
  topLabel?: string;
  /** Master timeline (bottom layer in compare mode). */
  videoRef?: RefObject<HTMLVideoElement | null>;
  onBottomTimeChange?: (sec: number) => void;
};

export function DualPlayheadVideo({
  videoSrc,
  lines,
  activeLineKey,
  offsetSec,
  bottomLabel = "Reference",
  topLabel = "Compare",
  videoRef,
  onBottomTimeChange,
}: Props) {
  const internalBottomRef = useRef<HTMLVideoElement>(null);
  const bottomRef = videoRef ?? internalBottomRef;
  const topRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const compareEnabled = offsetSec != null && Number.isFinite(offsetSec);

  useVideoOverlayFrameLockSync({
    bottomRef,
    topRef,
    offsetSec: offsetSec ?? 0,
    playbackRate: 1,
    enabled: compareEnabled && Boolean(videoSrc),
    isPlaying,
  });

  const syncPaused = useCallback(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || offsetSec == null) return;
    bottom.pause();
    top.pause();
    setIsPlaying(false);
    seekBottomAndSync(bottom, top, bottom.currentTime, offsetSec, 1);
  }, [offsetSec]);

  useEffect(() => {
    if (!compareEnabled) return;
    syncPaused();
  }, [compareEnabled, offsetSec, syncPaused, videoSrc]);

  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom || !onBottomTimeChange) return;
    const onTime = () => onBottomTimeChange(bottom.currentTime);
    bottom.addEventListener("timeupdate", onTime);
    return () => bottom.removeEventListener("timeupdate", onTime);
  }, [onBottomTimeChange, videoSrc]);

  async function togglePlay() {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || offsetSec == null) return;
    if (!bottom.paused) {
      pauseBoth(bottom, top);
      setIsPlaying(false);
      return;
    }
    await playBothSynced(bottom, top, offsetSec, 1);
    setIsPlaying(true);
  }

  if (!compareEnabled) {
    const singleRef = bottomRef;
    return (
      <div className="flex flex-col gap-2 min-w-0">
        <VideoViewTransform>
          <VideoWithLineOverlay
            videoSrc={videoSrc}
            lines={lines}
            activeLineKey={activeLineKey}
            videoRef={singleRef}
          />
        </VideoViewTransform>
        <VideoFrameControls videoRef={singleRef} active={!!videoSrc} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <VideoViewTransform>
        <div className="relative aspect-video w-full bg-black rounded-md overflow-hidden">
          <video
            ref={bottomRef}
            src={videoSrc ?? undefined}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            preload="metadata"
          />
          <video
            ref={topRef}
            src={videoSrc ?? undefined}
            className="absolute inset-0 h-full w-full object-contain opacity-45 mix-blend-screen pointer-events-none"
            playsInline
            muted
            preload="metadata"
          />
          <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {bottomLabel}
          </div>
          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            {topLabel} (ghost)
          </div>
        </div>
      </VideoViewTransform>
      <div className="flex flex-wrap items-center gap-2">
        <VideoFrameControls videoRef={bottomRef} active={!!videoSrc} />
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          disabled={!videoSrc}
          onClick={() => void togglePlay()}
        >
          {isPlaying ? "Pause both" : "Play both"}
        </button>
      </div>
    </div>
  );
}
