"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatClockTime,
  formatOffset,
  formatPlaybackRateLabel,
  PLAYBACK_RATE_PRESETS,
  type PlaybackRatePreset,
} from "@/components/videos/videoOverlayConstants";
import {
  jumpToStart,
  pauseBoth,
  playBothSynced,
  seekBottomAndSync,
} from "@/components/videos/videoOverlayPlayback";

type Props = {
  bottomRef: React.RefObject<HTMLVideoElement | null>;
  topRef: React.RefObject<HTMLVideoElement | null>;
  offsetSec: number;
  playbackRate: PlaybackRatePreset;
  onPlaybackRateChange: (rate: PlaybackRatePreset) => void;
  bothReady: boolean;
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
  compact?: boolean;
  dark?: boolean;
};

export function VideoOverlayTransport({
  bottomRef,
  topRef,
  offsetSec,
  playbackRate,
  onPlaybackRateChange,
  bothReady,
  isPlaying,
  onPlayingChange,
  compact = false,
  dark = false,
}: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom) return;

    const update = () => {
      setCurrentTime(bottom.currentTime);
      if (Number.isFinite(bottom.duration)) setDuration(bottom.duration);
    };

    update();
    bottom.addEventListener("timeupdate", update);
    bottom.addEventListener("loadedmetadata", update);
    bottom.addEventListener("durationchange", update);
    return () => {
      bottom.removeEventListener("timeupdate", update);
      bottom.removeEventListener("loadedmetadata", update);
      bottom.removeEventListener("durationchange", update);
    };
  }, [bottomRef, bothReady]);

  const handlePlayPause = useCallback(async () => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !bothReady) return;

    if (isPlaying) {
      pauseBoth(bottom, top);
      onPlayingChange(false);
      return;
    }

    await playBothSynced(bottom, top, offsetSec, playbackRate);
    onPlayingChange(true);
  }, [bottomRef, topRef, bothReady, isPlaying, offsetSec, playbackRate, onPlayingChange]);

  const handleScrub = useCallback(
    (timeSec: number) => {
      const bottom = bottomRef.current;
      const top = topRef.current;
      if (!bottom || !top) return;
      seekBottomAndSync(bottom, top, timeSec, offsetSec, playbackRate);
      setCurrentTime(timeSec);
      onPlayingChange(false);
    },
    [bottomRef, topRef, offsetSec, playbackRate, onPlayingChange]
  );

  const handleJumpStart = useCallback(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top) return;
    jumpToStart(bottom, top, offsetSec, playbackRate);
    setCurrentTime(0);
    onPlayingChange(false);
  }, [bottomRef, topRef, offsetSec, playbackRate, onPlayingChange]);

  const handleRateChange = useCallback(
    (rate: PlaybackRatePreset) => {
      onPlaybackRateChange(rate);
      const bottom = bottomRef.current;
      const top = topRef.current;
      if (bottom && top) {
        bottom.playbackRate = rate;
        top.playbackRate = rate;
      }
    },
    [bottomRef, topRef, onPlaybackRateChange]
  );

  const btn = dark
    ? "rounded-md border border-white/30 px-2 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-40"
    : "rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-40";

  const chip = (active: boolean) =>
    cn(
      "rounded-md border px-2 py-1 text-[11px] font-medium transition",
      dark
        ? active
          ? "border-white bg-white/20 text-white"
          : "border-white/30 text-white/80 hover:bg-white/10"
        : active
          ? "border-accent bg-accent/15 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
    );

  return (
    <div
      className={cn(
        "space-y-2",
        dark ? "text-white" : "",
        compact ? "text-[11px]" : "text-xs"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={!bothReady} onClick={() => void handlePlayPause()}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" className={btn} disabled={!bothReady} onClick={handleJumpStart}>
          Start
        </button>
        <span className={cn("tabular-nums", dark ? "text-white/80" : "text-muted-foreground")}>
          {formatClockTime(currentTime)}
          {duration > 0 ? ` / ${formatClockTime(duration)}` : ""}
        </span>
        <span className={cn("tabular-nums", dark ? "text-white/60" : "text-muted-foreground")}>
          offset {formatOffset(offsetSec)}
        </span>
        {bothReady ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px]",
              dark ? "bg-emerald-500/20 text-emerald-200" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            )}
          >
            Synced · ready
          </span>
        ) : (
          <span className={cn("text-[10px]", dark ? "text-white/50" : "text-muted-foreground")}>
            Buffering…
          </span>
        )}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.01}
          value={scrubbing ? currentTime : Math.min(currentTime, duration || currentTime)}
          disabled={!bothReady || duration <= 0}
          onPointerDown={() => setScrubbing(true)}
          onPointerUp={() => setScrubbing(false)}
          onChange={(e) => handleScrub(Number(e.target.value))}
          aria-label="Scrub bottom video timeline"
        />
      </label>

      <div className="flex flex-wrap items-center gap-1">
        <span className={cn("mr-1", dark ? "text-white/60" : "text-muted-foreground")}>Speed</span>
        {PLAYBACK_RATE_PRESETS.map((rate) => (
          <button
            key={rate}
            type="button"
            className={chip(playbackRate === rate)}
            disabled={!bothReady}
            onClick={() => handleRateChange(rate)}
          >
            {formatPlaybackRateLabel(rate)}
          </button>
        ))}
      </div>
    </div>
  );
}
