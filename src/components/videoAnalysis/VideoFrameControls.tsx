"use client";

import { useEffect, useState } from "react";

const DEFAULT_FPS = 60;
const SPEED_PRESETS = [2, 1, 0.5, 0.25, 0.1] as const;

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Ghost layer — same playback rate applied when stepping or changing speed. */
  secondaryVideoRef?: React.RefObject<HTMLVideoElement | null>;
  active?: boolean;
  fps?: number;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Called after frame step (e.g. sync ghost layer). */
  afterStep?: () => void;
};

export function VideoFrameControls({
  videoRef,
  secondaryVideoRef,
  active = false,
  fps = DEFAULT_FPS,
  playbackRate: controlledRate,
  onPlaybackRateChange,
  afterStep,
}: Props) {
  const [timeSec, setTimeSec] = useState(0);
  const [ready, setReady] = useState(false);
  const [internalRate, setInternalRate] = useState(1);
  const playbackRate = controlledRate ?? internalRate;

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setTimeSec(v.currentTime);
    const onMeta = () => setReady(true);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) setReady(true);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoRef, active]);

  function applyPlaybackRate(rate: number) {
    const bottom = videoRef.current;
    const top = secondaryVideoRef?.current;
    if (bottom) bottom.playbackRate = rate;
    if (top) top.playbackRate = rate;
    if (onPlaybackRateChange) onPlaybackRateChange(rate);
    else setInternalRate(rate);
  }

  useEffect(() => {
    if (!active) return;
    const bottom = videoRef.current;
    const top = secondaryVideoRef?.current;
    if (bottom) bottom.playbackRate = playbackRate;
    if (top) top.playbackRate = playbackRate;
  }, [active, playbackRate, videoRef, secondaryVideoRef]);

  function stepFrame(dir: -1 | 1) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    secondaryVideoRef?.current?.pause();
    const step = 1 / fps;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + dir * step));
    setTimeSec(v.currentTime);
    afterStep?.();
  }

  if (!active || !ready) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 hover:bg-muted"
        onClick={() => stepFrame(-1)}
        title={`Back 1 frame (~${fps} fps)`}
      >
        ◀ Frame
      </button>
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 hover:bg-muted"
        onClick={() => stepFrame(1)}
        title={`Forward 1 frame (~${fps} fps)`}
      >
        Frame ▶
      </button>
      <span className="text-muted-foreground">|</span>
      {SPEED_PRESETS.map((rate) => (
        <button
          key={rate}
          type="button"
          className={`rounded-md border px-2 py-1 font-mono tabular-nums ${
            playbackRate === rate
              ? "border-primary bg-primary/15"
              : "border-border hover:bg-muted"
          }`}
          onClick={() => applyPlaybackRate(rate)}
        >
          {rate}x
        </button>
      ))}
      <span className="font-mono text-muted-foreground tabular-nums">
        {timeSec.toFixed(3)}s
      </span>
    </div>
  );
}
