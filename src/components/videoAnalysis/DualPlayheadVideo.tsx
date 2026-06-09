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
import { hardSeekTop, seekVideoTo } from "@/components/videos/videoOverlaySync";
import { VideoViewTransform } from "./VideoViewTransform";

type Props = {
  videoSrc: string | null;
  lines: SectorLineNorm[];
  activeLineKey: string | null;
  /** Ghost (top) = bottom + offsetSec when both compare laps are selected. */
  offsetSec: number | null;
  /** True when my + competitor laps are picked — show dual-layer ghost view. */
  ghostCompareActive?: boolean;
  /** Snap bottom playhead here when compare alignment updates. */
  alignBottomSec?: number | null;
  bottomLabel?: string;
  topLabel?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onBottomTimeChange?: (sec: number) => void;
};

function SectorLinesSvg({
  lines,
  activeLineKey,
}: {
  lines: SectorLineNorm[];
  activeLineKey: string | null;
}) {
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none z-10"
      viewBox="0 0 1000 562.5"
      preserveAspectRatio="none"
    >
      {lines.map((ln) => {
        const active = ln.lineKey === activeLineKey;
        const color = ln.lineKey === "sf" ? "#22c55e" : active ? "#f97316" : "#60a5fa";
        return (
          <line
            key={ln.lineKey}
            x1={ln.x1 * 1000}
            y1={ln.y1 * 562.5}
            x2={ln.x2 * 1000}
            y2={ln.y2 * 562.5}
            stroke={color}
            strokeWidth={active ? 3 : 2}
            strokeDasharray={ln.lineKey === "sf" ? undefined : "6 4"}
          />
        );
      })}
    </svg>
  );
}

export function DualPlayheadVideo({
  videoSrc,
  lines,
  activeLineKey,
  offsetSec,
  ghostCompareActive = false,
  alignBottomSec = null,
  bottomLabel = "Reference",
  topLabel = "Compare",
  videoRef,
  onBottomTimeChange,
}: Props) {
  const internalBottomRef = useRef<HTMLVideoElement>(null);
  const bottomRef = videoRef ?? internalBottomRef;
  const topRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const showGhost =
    ghostCompareActive && offsetSec != null && Number.isFinite(offsetSec) && Boolean(videoSrc);

  useVideoOverlayFrameLockSync({
    bottomRef,
    topRef,
    offsetSec: offsetSec ?? 0,
    playbackRate,
    enabled: showGhost,
    isPlaying,
  });

  const syncGhostToBottom = useCallback(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || offsetSec == null) return;
    hardSeekTop(bottom, top, offsetSec);
  }, [bottomRef, offsetSec]);

  const syncBothNow = useCallback(
    (bottomTime: number) => {
      const bottom = bottomRef.current;
      const top = topRef.current;
      if (!bottom || !top || offsetSec == null) return;
      seekVideoTo(bottom, bottomTime);
      hardSeekTop(bottom, top, offsetSec);
    },
    [bottomRef, offsetSec]
  );

  useEffect(() => {
    if (!showGhost || alignBottomSec == null || !Number.isFinite(alignBottomSec)) return;
    syncBothNow(alignBottomSec);
  }, [showGhost, alignBottomSec, offsetSec, syncBothNow, videoSrc]);

  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom || !onBottomTimeChange) return;
    const onTime = () => onBottomTimeChange(bottom.currentTime);
    bottom.addEventListener("timeupdate", onTime);
    return () => bottom.removeEventListener("timeupdate", onTime);
  }, [bottomRef, onBottomTimeChange, videoSrc]);

  async function togglePlay() {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || offsetSec == null) return;
    if (!bottom.paused) {
      pauseBoth(bottom, top);
      setIsPlaying(false);
      return;
    }
    await playBothSynced(bottom, top, offsetSec, playbackRate);
    setIsPlaying(true);
  }

  if (!showGhost) {
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
        <VideoFrameControls
          videoRef={singleRef}
          active={!!videoSrc}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <VideoViewTransform>
        <div className="relative aspect-video w-full bg-black rounded-md overflow-hidden border border-border">
          <video
            ref={bottomRef}
            src={videoSrc ?? undefined}
            className="absolute inset-0 h-full w-full object-contain pointer-events-none"
            style={{ opacity: 0.5 }}
            playsInline
            preload="metadata"
          />
          <video
            ref={topRef}
            src={videoSrc ?? undefined}
            className="absolute inset-0 h-full w-full object-contain pointer-events-none"
            style={{ opacity: 0.5 }}
            playsInline
            muted
            preload="metadata"
          />
          <SectorLinesSvg lines={lines} activeLineKey={activeLineKey} />
          <div className="absolute bottom-1 left-1 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white border border-white/20">
            {bottomLabel}
          </div>
          <div className="absolute bottom-1 right-1 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white border border-white/20">
            {topLabel} · ghost
          </div>
        </div>
      </VideoViewTransform>
      <p className="text-[10px] text-muted-foreground">
        Both layers at 50% — bottom is your lap at SF, top is competitor at SF. Play both to scrub
        in sync.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <VideoFrameControls
          videoRef={bottomRef}
          secondaryVideoRef={topRef}
          active={!!videoSrc}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          afterStep={syncGhostToBottom}
        />
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
