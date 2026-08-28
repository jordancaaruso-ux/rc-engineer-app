"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { SegmentWindow } from "@/lib/videoAnalysis/lapCompare";
import {
  describeVideoError,
  diagnoseMissingPicture,
} from "@/lib/videos/videoPlaybackDiagnosis";

/**
 * Ghosted sector clip: the same analyzed video loaded twice, both laps seeked to
 * their own crossing of the sector's entry line and played position-synced — the
 * ghost (lap B) drifts behind/ahead by exactly the sector delta. Playback runs to
 * the slower lap's exit so the gap at the line is visible.
 */
export function SectorClipPlayer({
  videoUrl,
  aWindow,
  bWindow,
  aLabel,
  bLabel,
  fit = "card",
  ticks,
}: {
  videoUrl: string;
  aWindow: SegmentWindow;
  bWindow: SegmentWindow;
  aLabel: string;
  bLabel: string;
  /**
   * Seconds into clip A to mark on the scrubber — the sector lines when the clip is a whole
   * lap, so the driver can see which corner the gap opened at.
   */
  ticks?: number[];
  /**
   * "card" (default): a 16:9 box the width of its card. "window": the picture is the page —
   * the box takes the video's own shape and grows until it is as tall as the window allows,
   * so a wide phone clip is not a strip inside a 16:9 hole.
   */
  fit?: "card" | "window";
}) {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);
  const [playbackNote, setPlaybackNote] = useState<string | null>(null);
  const [aspect, setAspect] = useState(16 / 9);

  const aDur = aWindow.endSec - aWindow.startSec;
  const bDur = bWindow.endSec - bWindow.startSec;
  const clipDur = Math.max(aDur, bDur);

  // Re-seek whenever the sector windows change (new segment tapped).
  useEffect(() => {
    stopLoop();
    setPlaying(false);
    setClock(0);
    seekTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aWindow.startSec, bWindow.startSec]);

  useEffect(() => stopLoop, []);

  function stopLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function seekTo(t: number) {
    const a = aRef.current;
    const b = bRef.current;
    if (a) a.currentTime = aWindow.startSec + t;
    if (b) b.currentTime = bWindow.startSec + t;
    setClock(t);
  }

  function tick() {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    const t = a.currentTime - aWindow.startSec;
    // Keep the ghost frame-synced to the master; only hard-seek on real drift so
    // we don't thrash the decoder every frame.
    const desiredB = bWindow.startSec + t;
    if (Math.abs(b.currentTime - desiredB) > 0.08) b.currentTime = desiredB;
    setClock(Math.min(t, clipDur));
    if (t >= clipDur) {
      a.pause();
      b.pause();
      setPlaying(false);
      stopLoop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function togglePlay() {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;
    if (playing) {
      a.pause();
      b.pause();
      setPlaying(false);
      stopLoop();
      return;
    }
    if (clock >= clipDur - 0.02) seekTo(0);
    try {
      await Promise.all([a.play(), b.play()]);
    } catch {
      return; // autoplay rejection — user can tap again
    }
    setPlaying(true);
    stopLoop();
    rafRef.current = requestAnimationFrame(tick);
  }

  function onScrub(value: number) {
    const a = aRef.current;
    const b = bRef.current;
    if (a && playing) {
      a.pause();
      b?.pause();
      setPlaying(false);
      stopLoop();
    }
    seekTo(value);
  }

  return (
    <div className={fit === "window" ? "mx-auto space-y-2" : "space-y-2"} style={fit === "window" ? { maxWidth: `calc((100svh - 11rem) * ${aspect})` } : undefined}>
      {playbackNote ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive">
          {playbackNote}
        </p>
      ) : null}
      <div
        className={
          fit === "window"
            ? "relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-black"
            : "relative aspect-video overflow-hidden rounded-lg border border-border bg-black"
        }
        style={
          fit === "window"
            ? // Height-capped by width, the same trick the marking flow uses: the box can only
              // be as wide as a (window − chrome)-tall picture of this shape.
              { aspectRatio: String(aspect), maxWidth: `calc((100svh - 11rem) * ${aspect})` }
            : undefined
        }
      >
        <video
          ref={aRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-contain"
          onError={(e) => setPlaybackNote(describeVideoError(e.currentTarget))}
          onLoadedMetadata={(e) => {
            setPlaybackNote(diagnoseMissingPicture(e.currentTarget)?.message ?? null);
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
            if (aRef.current) aRef.current.currentTime = aWindow.startSec;
          }}
        />
        <video
          ref={bRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-50"
          onLoadedMetadata={() => {
            if (bRef.current) bRef.current.currentTime = bWindow.startSec;
          }}
        />
        <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-between">
          <span className="rounded bg-background/70 px-1.5 py-0.5 tabular-nums text-[9px] tracking-[0.15em] text-foreground backdrop-blur-sm">
            {aLabel}
          </span>
          <span className="rounded bg-background/70 px-1.5 py-0.5 tabular-nums text-[9px] tracking-[0.15em] text-muted-foreground backdrop-blur-sm">
            {bLabel} · GHOST
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause clip" : "Play clip"}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full primary-face bg-primary text-primary-foreground shadow-[0_2px_10px_rgba(255,214,10,0.3)] hover:bg-[#E6BE00] transition"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={clipDur}
            step={0.01}
            value={Math.min(clock, clipDur)}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label="Scrub clip"
            className="block w-full accent-primary-ink"
          />
          {ticks && clipDur > 0
            ? ticks
                .filter((t) => t > 0 && t < clipDur)
                .map((t) => (
                  <span
                    key={t}
                    aria-hidden
                    className="pointer-events-none absolute -bottom-0.5 h-1.5 w-px bg-foreground/60"
                    style={{ left: `${(t / clipDur) * 100}%` }}
                  />
                ))
            : null}
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-faint">
          {Math.min(clock, clipDur).toFixed(1)} / {clipDur.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
