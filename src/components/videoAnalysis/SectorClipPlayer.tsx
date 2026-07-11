"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { SegmentWindow } from "@/lib/videoAnalysis/lapCompare";

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
}: {
  videoUrl: string;
  aWindow: SegmentWindow;
  bWindow: SegmentWindow;
  aLabel: string;
  bLabel: string;
}) {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);

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
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
        <video
          ref={aRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={() => {
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
          <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.15em] text-foreground backdrop-blur-sm">
            {aLabel}
          </span>
          <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.15em] text-muted-foreground backdrop-blur-sm">
            {bLabel} · GHOST
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause clip" : "Play clip"}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_2px_10px_rgba(255,214,10,0.3)] hover:bg-[#E6BE00] transition"
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={clipDur}
          step={0.01}
          value={Math.min(clock, clipDur)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Scrub sector clip"
          className="min-w-0 flex-1 accent-[#FFD60A]"
        />
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
          {Math.min(clock, clipDur).toFixed(1)} / {clipDur.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
