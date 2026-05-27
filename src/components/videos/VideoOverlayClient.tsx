"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildOverlayTransform,
  buildTransformOrigin,
  DEFAULT_OVERLAY_ALIGNMENT,
  type OverlayAlignment,
} from "@/components/videos/videoOverlayAlignment";
import { VideoOverlayAlignmentPanel } from "@/components/videos/VideoOverlayAlignmentPanel";
import {
  clamp,
  clampOffset,
  FINE_OFFSET_RANGE_SEC,
  formatOffset,
  isMobileOverlayUi,
  MAX_OFFSET_SEC,
  parseOffset,
} from "@/components/videos/videoOverlayConstants";
import { useVideoOverlayFullscreen } from "@/components/videos/useVideoOverlayFullscreen";
import { useVideoOverlaySync } from "@/components/videos/useVideoOverlaySync";

function VideoLoadingOverlay({ label, loading }: { label: string; loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 text-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <span className="mt-2 px-4 text-center text-[11px] opacity-90">{label}</span>
    </div>
  );
}

export function VideoOverlayClient() {
  const bottomRef = useRef<HTMLVideoElement>(null);
  const topRef = useRef<HTMLVideoElement>(null);
  const bottomObjectUrlRef = useRef<string | null>(null);
  const topObjectUrlRef = useRef<string | null>(null);
  const pendingTopFileRef = useRef<File | null>(null);

  const [bottomSrc, setBottomSrc] = useState("");
  const [topSrc, setTopSrc] = useState("");
  const [bottomName, setBottomName] = useState("");
  const [topName, setTopName] = useState("");
  const [bottomReady, setBottomReady] = useState(false);
  const [bottomLoading, setBottomLoading] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [topPreload, setTopPreload] = useState<"none" | "metadata">("none");

  const [topOpacity, setTopOpacity] = useState(0.45);
  const [offsetSec, setOffsetSec] = useState(0);
  const [offsetInput, setOffsetInput] = useState("0:00.00");
  const [nudgeMs, setNudgeMs] = useState(20);
  const [alignment, setAlignment] = useState<OverlayAlignment>(DEFAULT_OVERLAY_ALIGNMENT);
  const [alignExpanded, setAlignExpanded] = useState(false);
  const [alignDrawerOpen, setAlignDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const { isFullscreen, enterFullscreen, exitFullscreen, showRotateHint } = useVideoOverlayFullscreen();

  const canPlay = Boolean(bottomSrc && topSrc);

  useEffect(() => {
    setIsMobile(isMobileOverlayUi());
  }, []);

  const loadTopFromFile = useCallback((file: File) => {
    if (topObjectUrlRef.current) {
      URL.revokeObjectURL(topObjectUrlRef.current);
      topObjectUrlRef.current = null;
    }
    const url = URL.createObjectURL(file);
    topObjectUrlRef.current = url;
    setTopSrc(url);
    setTopName(file.name || "top video");
    setTopPreload("metadata");
    setTopLoading(true);
  }, []);

  const setBottomFile = useCallback((file: File | null) => {
    if (bottomObjectUrlRef.current) {
      URL.revokeObjectURL(bottomObjectUrlRef.current);
      bottomObjectUrlRef.current = null;
    }
    setBottomReady(false);
    if (!file) {
      setBottomSrc("");
      setBottomName("");
      setBottomLoading(false);
      return;
    }
    const url = URL.createObjectURL(file);
    bottomObjectUrlRef.current = url;
    setBottomSrc(url);
    setBottomName(file.name || "bottom video");
    setBottomLoading(true);
  }, []);

  const setTopFile = useCallback(
    (file: File | null) => {
      pendingTopFileRef.current = file;
      if (!file) {
        if (topObjectUrlRef.current) {
          URL.revokeObjectURL(topObjectUrlRef.current);
          topObjectUrlRef.current = null;
        }
        setTopSrc("");
        setTopName("");
        setTopLoading(false);
        setTopPreload("none");
        return;
      }
      if (bottomReady) {
        loadTopFromFile(file);
      } else {
        setTopName(file.name || "top video");
        setTopLoading(true);
      }
    },
    [bottomReady, loadTopFromFile]
  );

  useEffect(() => {
    return () => {
      if (bottomObjectUrlRef.current) URL.revokeObjectURL(bottomObjectUrlRef.current);
      if (topObjectUrlRef.current) URL.revokeObjectURL(topObjectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!bottomReady || !pendingTopFileRef.current || topSrc) return;
    loadTopFromFile(pendingTopFileRef.current);
  }, [bottomReady, topSrc, loadTopFromFile]);

  useEffect(() => {
    setOffsetInput(formatOffset(offsetSec));
  }, [offsetSec]);

  useVideoOverlaySync({
    bottomRef,
    topRef,
    offsetSec,
    enabled: canPlay,
  });

  const applyOffset = useCallback((next: number) => {
    setOffsetSec(clampOffset(next));
  }, []);

  const nudgeOffset = useCallback(
    (deltaSec: number) => {
      setOffsetSec((s) => clampOffset(s + deltaSec));
    },
    []
  );

  const commitOffsetInput = useCallback(() => {
    const parsed = parseOffset(offsetInput);
    if (parsed != null) setOffsetSec(parsed);
    else setOffsetInput(formatOffset(offsetSec));
  }, [offsetInput, offsetSec]);

  const fineMin = clamp(offsetSec - FINE_OFFSET_RANGE_SEC, -MAX_OFFSET_SEC, MAX_OFFSET_SEC);
  const fineMax = clamp(offsetSec + FINE_OFFSET_RANGE_SEC, -MAX_OFFSET_SEC, MAX_OFFSET_SEC);

  const topTransform = buildOverlayTransform(alignment);
  const topOrigin = buildTransformOrigin(alignment);

  const togglePlay = () => {
    const bottom = bottomRef.current;
    if (!bottom) return;
    if (bottom.paused) bottom.play().catch(() => {});
    else bottom.pause();
  };

  const playerBlock = (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-black",
        isFullscreen ? "flex-1 min-h-0 rounded-none border-0" : "rounded-md border border-border aspect-video"
      )}
    >
      <video
        ref={bottomRef}
        src={bottomSrc || undefined}
        controls={!isFullscreen}
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-contain"
        onLoadStart={() => setBottomLoading(true)}
        onWaiting={() => setBottomLoading(true)}
        onCanPlay={() => {
          setBottomLoading(false);
          setBottomReady(true);
        }}
        onLoadedData={() => setBottomLoading(false)}
      />
      <video
        ref={topRef}
        src={topSrc || undefined}
        muted
        playsInline
        preload={topPreload}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        style={{
          opacity: topOpacity,
          transform: topTransform,
          transformOrigin: topOrigin,
        }}
        onLoadStart={() => setTopLoading(true)}
        onWaiting={() => setTopLoading(true)}
        onCanPlay={() => setTopLoading(false)}
        onLoadedData={() => setTopLoading(false)}
      />
      <VideoLoadingOverlay label={bottomName || "Loading bottom video…"} loading={bottomLoading && Boolean(bottomSrc)} />
      <VideoLoadingOverlay label={topName || "Loading top video…"} loading={topLoading && Boolean(topSrc)} />
    </div>
  );

  const offsetControls = (
    <div className="space-y-3">
      <label className="block text-xs">
        <span className="text-muted-foreground">Top opacity: {topOpacity.toFixed(2)}</span>
        <input
          className="mt-1 w-full"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={topOpacity}
          onChange={(e) => setTopOpacity(Number(e.target.value))}
        />
      </label>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          Time offset (top = bottom + offset): {formatOffset(offsetSec)}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[7rem] flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            value={offsetInput}
            onChange={(e) => setOffsetInput(e.target.value)}
            onBlur={commitOffsetInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitOffsetInput();
            }}
            placeholder="m:ss.ss or seconds"
            aria-label="Time offset"
          />
        </div>
      </div>

      <label className="block text-xs">
        <span className="text-muted-foreground">Fine tune (±{FINE_OFFSET_RANGE_SEC}s around current)</span>
        <input
          className="mt-1 w-full"
          type="range"
          min={fineMin}
          max={fineMax}
          step={0.01}
          value={offsetSec}
          onChange={(e) => applyOffset(Number(e.target.value))}
        />
      </label>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="text-muted-foreground">Nudge</span>
          <select
            className="mt-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
            value={nudgeMs}
            onChange={(e) => setNudgeMs(Number(e.target.value))}
          >
            <option value={10}>10ms</option>
            <option value={20}>20ms</option>
            <option value={50}>50ms</option>
            <option value={100}>100ms</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(-nudgeMs / 1000)}
        >
          −{nudgeMs}ms
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(nudgeMs / 1000)}
        >
          +{nudgeMs}ms
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(-1)}
        >
          −1s
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(1)}
        >
          +1s
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(-10)}
        >
          −10s
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => nudgeOffset(10)}
        >
          +10s
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
          onClick={() => applyOffset(0)}
        >
          Reset
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {!isFullscreen ? (
        <div className="grid max-w-4xl gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="text-muted-foreground">Bottom (controls + audio)</span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                type="file"
                accept="video/*"
                onChange={(e) => setBottomFile(e.target.files?.[0] ?? null)}
              />
              {bottomName ? <div className="mt-1 text-[11px] text-muted-foreground">{bottomName}</div> : null}
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Top (overlay)</span>
              <input
                className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-xs outline-none"
                type="file"
                accept="video/*"
                onChange={(e) => setTopFile(e.target.files?.[0] ?? null)}
              />
              {topName ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {topName}
                  {!bottomReady && pendingTopFileRef.current ? " · waiting for bottom video" : ""}
                </div>
              ) : null}
            </label>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          isFullscreen &&
            "fixed inset-0 z-50 flex flex-col bg-black pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
        )}
      >
        <div
          className={cn(
            "space-y-4",
            isFullscreen ? "flex min-h-0 flex-1 flex-col px-2 pt-2" : "rounded-lg border border-border bg-card p-4"
          )}
        >
          {!isFullscreen ? (
            <div className="ui-title flex items-center justify-between text-xs text-muted-foreground">
              <span>Overlay player</span>
              {isMobile ? (
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted md:hidden"
                  onClick={() => void enterFullscreen()}
                >
                  Fullscreen
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-[11px] text-white/80">
              <span>{showRotateHint ? "Rotate to landscape for best view" : "Landscape fullscreen"}</span>
              <button
                type="button"
                className="rounded-md border border-white/30 px-2 py-1 text-white hover:bg-white/10"
                onClick={exitFullscreen}
              >
                Exit
              </button>
            </div>
          )}

          {playerBlock}

          {isFullscreen ? (
            <>
              <div className="shrink-0 space-y-2 rounded-lg bg-black/80 p-2 text-white backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-white/30 px-3 py-2 text-xs"
                    onClick={togglePlay}
                  >
                    Play / Pause
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/30 px-2 py-2 text-xs"
                    onClick={() => nudgeOffset(-1)}
                  >
                    −1s
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-white/30 px-2 py-2 text-xs"
                    onClick={() => nudgeOffset(1)}
                  >
                    +1s
                  </button>
                  <span className="text-[11px] opacity-80">{formatOffset(offsetSec)}</span>
                  <label className="ml-auto flex min-w-[8rem] flex-1 items-center gap-2 text-[10px]">
                    Opacity
                    <input
                      className="flex-1"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={topOpacity}
                      onChange={(e) => setTopOpacity(Number(e.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-md border border-white/30 px-2 py-2 text-xs"
                    onClick={() => setAlignDrawerOpen((v) => !v)}
                  >
                    Align
                  </button>
                </div>
              </div>
              {alignDrawerOpen ? (
                <div className="max-h-[40vh] shrink-0 overflow-y-auto rounded-lg border border-white/20 bg-zinc-900/95 p-3 text-white">
                  <VideoOverlayAlignmentPanel
                    alignment={alignment}
                    onChange={setAlignment}
                    expanded
                    onToggleExpanded={() => setAlignDrawerOpen(false)}
                    compact
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {offsetControls}
              <VideoOverlayAlignmentPanel
                alignment={alignment}
                onChange={setAlignment}
                expanded={alignExpanded}
                onToggleExpanded={() => setAlignExpanded((v) => !v)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
