"use client";

import { useEffect, useState } from "react";

const DEFAULT_FPS = 60;
const SPEED_PRESETS = [2, 1, 0.5, 0.25, 0.1] as const;
const DEFAULT_JUMP_SEC = [0.5, 1, 5] as const;

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Ghost layer — same playback rate applied when stepping or changing speed. */
  secondaryVideoRef?: React.RefObject<HTMLVideoElement | null>;
  active?: boolean;
  fps?: number;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Called after frame step or seek (e.g. sync ghost layer). */
  afterStep?: () => void;
  /** Show scrub slider + time-jump buttons (compare mode). */
  compareScrub?: boolean;
  jumpIntervalsSec?: readonly number[];
  /** Seek both layers to lap-start sync (compare ghost mode). */
  onLapStart?: () => void;
};

export function VideoFrameControls({
  videoRef,
  secondaryVideoRef,
  active = false,
  fps = DEFAULT_FPS,
  playbackRate: controlledRate,
  onPlaybackRateChange,
  afterStep,
  compareScrub = false,
  jumpIntervalsSec = DEFAULT_JUMP_SEC,
  onLapStart,
}: Props) {
  const [timeSec, setTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
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
    const onTime = () => {
      setTimeSec(v.currentTime);
      if (Number.isFinite(v.duration)) setDurationSec(v.duration);
    };
    const onMeta = () => {
      setReady(true);
      if (Number.isFinite(v.duration)) setDurationSec(v.duration);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
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

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    secondaryVideoRef?.current?.pause();
    const max = Number.isFinite(v.duration) ? v.duration : Infinity;
    const t = Math.max(0, Math.min(max, sec));
    v.currentTime = t;
    setTimeSec(t);
    afterStep?.();
  }

  function stepFrame(dir: -1 | 1) {
    const v = videoRef.current;
    if (!v) return;
    const step = 1 / fps;
    seekTo(v.currentTime + dir * step);
  }

  function jumpSec(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    seekTo(v.currentTime + delta);
  }

  if (!active || !ready) return null;

  return (
    <div className="flex flex-col gap-2 text-xs w-full min-w-0">
      {compareScrub && (
        <div className="flex flex-col gap-1 w-full">
          <input
            type="range"
            min={0}
            max={durationSec > 0 ? durationSec : 1}
            step={0.01}
            value={Math.min(timeSec, durationSec > 0 ? durationSec : timeSec)}
            className="w-full accent-primary"
            onChange={(e) => seekTo(parseFloat(e.target.value))}
          />
          <div className="flex flex-wrap items-center gap-1">
            {[...jumpIntervalsSec].reverse().map((sec) => (
              <button
                key={`back-${sec}`}
                type="button"
                className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted font-mono tabular-nums"
                onClick={() => jumpSec(-sec)}
              >
                −{sec}s
              </button>
            ))}
            <span className="font-mono text-muted-foreground tabular-nums px-1">
              {timeSec.toFixed(2)}s
            </span>
            {jumpIntervalsSec.map((sec) => (
              <button
                key={`fwd-${sec}`}
                type="button"
                className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted font-mono tabular-nums"
                onClick={() => jumpSec(sec)}
              >
                +{sec}s
              </button>
            ))}
            {onLapStart ? (
              <button
                type="button"
                className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted ml-0.5"
                onClick={onLapStart}
              >
                Lap start
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
        {!compareScrub && (
          <span className="font-mono text-muted-foreground tabular-nums">
            {timeSec.toFixed(3)}s
          </span>
        )}
      </div>
    </div>
  );
}
