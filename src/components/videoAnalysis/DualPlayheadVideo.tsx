"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { VideoWithLineOverlay } from "./VideoWithLineOverlay";
import {
  appliedVideoCropStyle,
  VIDEO_FRAME_ASPECT,
} from "@/lib/manualVideoAnalysis/videoViewCrop";
import { VideoCropFrame } from "./VideoCropFrame";
import type { VideoViewCropNorm } from "@/lib/manualVideoAnalysis/types";
import type { SectorLineNorm } from "./SectorLineCanvas";
import { VideoFrameControls } from "./VideoFrameControls";
import { useVideoOverlayFrameLockSync } from "@/components/videos/useVideoOverlayFrameLockSync";
import {
  pauseBoth,
  playBothSynced,
} from "@/components/videos/videoOverlayPlayback";
import { hardSeekTop, seekVideoTo } from "@/components/videos/videoOverlaySync";

const SYNC_NUDGE_SEC = [0.05, 0.1, 0.2] as const;

type Props = {
  videoSrc: string | null;
  lines: SectorLineNorm[];
  activeLineKey: string | null;
  offsetSec: number | null;
  ghostCompareActive?: boolean;
  alignBottomSec?: number | null;
  syncNudgeSec?: number;
  onSyncNudge?: (deltaSec: number) => void;
  bottomLabel?: string;
  topLabel?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onBottomTimeChange?: (sec: number) => void;
  viewCropNorm?: VideoViewCropNorm | null;
  cropSelectMode?: boolean;
  draftCrop?: VideoViewCropNorm | null;
  onDraftCropChange?: (crop: VideoViewCropNorm | null) => void;
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
  syncNudgeSec = 0,
  onSyncNudge,
  bottomLabel = "Reference",
  topLabel = "Compare",
  videoRef,
  onBottomTimeChange,
  viewCropNorm = null,
  cropSelectMode = false,
  draftCrop = null,
  onDraftCropChange,
}: Props) {
  const internalBottomRef = useRef<HTMLVideoElement>(null);
  const bottomRef = videoRef ?? internalBottomRef;
  const topRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [videoAspect, setVideoAspect] = useState(VIDEO_FRAME_ASPECT);
  const showGhost =
    ghostCompareActive &&
    offsetSec != null &&
    Number.isFinite(offsetSec) &&
    Boolean(videoSrc) &&
    !cropSelectMode;

  const displayCrop = cropSelectMode ? null : viewCropNorm;
  const offsetSecRef = useRef(offsetSec);
  offsetSecRef.current = offsetSec;

  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom || !videoSrc) return;
    const syncAspect = () => {
      if (bottom.videoWidth > 0 && bottom.videoHeight > 0) {
        setVideoAspect(bottom.videoWidth / bottom.videoHeight);
      }
    };
    syncAspect();
    bottom.addEventListener("loadedmetadata", syncAspect);
    return () => bottom.removeEventListener("loadedmetadata", syncAspect);
  }, [bottomRef, videoSrc]);

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
      const offset = offsetSecRef.current;
      if (!bottom || !top || offset == null) return;
      seekVideoTo(bottom, bottomTime);
      hardSeekTop(bottom, top, offset);
    },
    [bottomRef]
  );

  const seekToLapStart = useCallback(() => {
    if (alignBottomSec == null || !Number.isFinite(alignBottomSec)) return;
    syncBothNow(alignBottomSec);
  }, [alignBottomSec, syncBothNow]);

  useEffect(() => {
    if (!showGhost || alignBottomSec == null || !Number.isFinite(alignBottomSec)) return;
    syncBothNow(alignBottomSec);
  }, [showGhost, alignBottomSec, syncBothNow, videoSrc]);

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
        <VideoWithLineOverlay
          videoSrc={videoSrc}
          lines={lines}
          activeLineKey={activeLineKey}
          videoRef={singleRef}
          viewCropNorm={viewCropNorm}
          cropSelectMode={cropSelectMode}
          draftCrop={draftCrop}
          onDraftCropChange={onDraftCropChange}
          hideControls={cropSelectMode}
        />
        {!cropSelectMode ? (
          <VideoFrameControls
            videoRef={singleRef}
            active={!!videoSrc}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
            compareScrub={!!videoSrc}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <VideoCropFrame
        crop={displayCrop}
        videoAspect={videoAspect}
        rounded={false}
        className="rounded-md"
      >
        <div className="absolute inset-0">
          <video
            ref={bottomRef}
            src={videoSrc ?? undefined}
            className={
              displayCrop
                ? "absolute pointer-events-none"
                : "absolute inset-0 h-full w-full object-contain pointer-events-none"
            }
            style={{
              opacity: 0.5,
              ...(displayCrop ? appliedVideoCropStyle(displayCrop) : {}),
            }}
            playsInline
            preload="metadata"
          />
          <video
            ref={topRef}
            src={videoSrc ?? undefined}
            className={
              displayCrop
                ? "absolute pointer-events-none"
                : "absolute inset-0 h-full w-full object-contain pointer-events-none"
            }
            style={{
              opacity: 0.5,
              ...(displayCrop ? appliedVideoCropStyle(displayCrop) : {}),
            }}
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
      </VideoCropFrame>
      <VideoFrameControls
        videoRef={bottomRef}
        secondaryVideoRef={topRef}
        active={!!videoSrc}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        afterStep={syncGhostToBottom}
        compareScrub
        onLapStart={alignBottomSec != null ? seekToLapStart : undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          disabled={!videoSrc}
          onClick={() => void togglePlay()}
        >
          {isPlaying ? "Pause both" : "Play both"}
        </button>
      </div>
      {onSyncNudge && (
        <div className="rounded-md border border-border bg-card p-2 space-y-1.5">
          <p className="text-xs font-medium">Change sync</p>
          <p className="text-[10px] text-muted-foreground">
            Nudge {topLabel} earlier or later vs {bottomLabel}
            {syncNudgeSec !== 0 && (
              <span className="font-mono">
                {" "}
                ({syncNudgeSec >= 0 ? "+" : ""}
                {syncNudgeSec.toFixed(2)}s)
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-0.5">Earlier</span>
            {[...SYNC_NUDGE_SEC].reverse().map((sec) => (
              <button
                key={`nudge-${sec}`}
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted"
                onClick={() => onSyncNudge(-sec)}
              >
                −{sec}s
              </button>
            ))}
            <span className="text-muted-foreground mx-0.5">|</span>
            <span className="text-[10px] text-muted-foreground mr-0.5">Later</span>
            {SYNC_NUDGE_SEC.map((sec) => (
              <button
                key={`nudge+${sec}`}
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted"
                onClick={() => onSyncNudge(sec)}
              >
                +{sec}s
              </button>
            ))}
            {syncNudgeSec !== 0 && (
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted ml-1"
                onClick={() => onSyncNudge(-syncNudgeSec)}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
