"use client";

import { useEffect, useRef, useState } from "react";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function useRafLoop(enabled: boolean, cb: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      cb();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, cb]);
}

export function VideoOverlayClient() {
  const bottomRef = useRef<HTMLVideoElement>(null);
  const topRef = useRef<HTMLVideoElement>(null);

  const [bottomSrc, setBottomSrc] = useState<string>("");
  const [topSrc, setTopSrc] = useState<string>("");
  const bottomObjectUrlRef = useRef<string | null>(null);
  const topObjectUrlRef = useRef<string | null>(null);

  const [bottomName, setBottomName] = useState<string>("");
  const [topName, setTopName] = useState<string>("");
  const [topOpacity, setTopOpacity] = useState(0.45);
  const [offsetSec, setOffsetSec] = useState(0);
  const [nudgeMs, setNudgeMs] = useState(20);
  const [scale, setScale] = useState(1);
  const [shiftX, setShiftX] = useState(0);
  const [shiftY, setShiftY] = useState(0);

  const canPlay = Boolean(bottomSrc && topSrc);

  function setBottomFile(file: File | null) {
    if (bottomObjectUrlRef.current) {
      URL.revokeObjectURL(bottomObjectUrlRef.current);
      bottomObjectUrlRef.current = null;
    }
    if (!file) {
      setBottomSrc("");
      setBottomName("");
      return;
    }
    const url = URL.createObjectURL(file);
    bottomObjectUrlRef.current = url;
    setBottomSrc(url);
    setBottomName(file.name || "bottom video");
  }

  function setTopFile(file: File | null) {
    if (topObjectUrlRef.current) {
      URL.revokeObjectURL(topObjectUrlRef.current);
      topObjectUrlRef.current = null;
    }
    if (!file) {
      setTopSrc("");
      setTopName("");
      return;
    }
    const url = URL.createObjectURL(file);
    topObjectUrlRef.current = url;
    setTopSrc(url);
    setTopName(file.name || "top video");
  }

  useEffect(() => {
    return () => {
      if (bottomObjectUrlRef.current) URL.revokeObjectURL(bottomObjectUrlRef.current);
      if (topObjectUrlRef.current) URL.revokeObjectURL(topObjectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top) return;

    const onPlay = () => {
      top.playbackRate = bottom.playbackRate;
      top.muted = true;
      top.play().catch(() => {});
    };
    const onPause = () => top.pause();
    const onRate = () => {
      top.playbackRate = bottom.playbackRate;
    };
    const onSeek = () => {
      const target = bottom.currentTime + offsetSec;
      if (Number.isFinite(target)) top.currentTime = Math.max(0, target);
    };

    bottom.addEventListener("play", onPlay);
    bottom.addEventListener("pause", onPause);
    bottom.addEventListener("ratechange", onRate);
    bottom.addEventListener("seeked", onSeek);
    bottom.addEventListener("seeking", onSeek);
    return () => {
      bottom.removeEventListener("play", onPlay);
      bottom.removeEventListener("pause", onPause);
      bottom.removeEventListener("ratechange", onRate);
      bottom.removeEventListener("seeked", onSeek);
      bottom.removeEventListener("seeking", onSeek);
    };
  }, [offsetSec]);

  useRafLoop(canPlay, () => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top) return;
    if (bottom.paused) return;
    const target = bottom.currentTime + offsetSec;
    if (!Number.isFinite(target)) return;
    // Keep drift small without constant jitter; tolerate 40ms.
    if (Math.abs(top.currentTime - target) > 0.04) {
      top.currentTime = Math.max(0, target);
    }
  });

  // Live preview of the offset slider / nudge buttons while paused. Without
  // this, the top video only re-syncs via (a) the raf loop during playback,
  // or (b) a bottom-video seek event — so dragging the offset slider on a
  // paused video looked dead until the user pressed play+pause. Reapply the
  // sync on any `offsetSec` change so the new frame is shown immediately.
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top) return;
    const target = bottom.currentTime + offsetSec;
    if (Number.isFinite(target)) {
      top.currentTime = Math.max(0, target);
    }
  }, [offsetSec]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 max-w-4xl">
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
            {topName ? <div className="mt-1 text-[11px] text-muted-foreground">{topName}</div> : null}
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="ui-title text-xs uppercase tracking-wide text-muted-foreground">Overlay player</div>

        <div
          className="rounded-md border border-border bg-black overflow-hidden"
          style={{ position: "relative", width: "100%", aspectRatio: "16 / 9" }}
        >
          <video
            ref={bottomRef}
            src={bottomSrc || undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full"
          />
          <video
            ref={topRef}
            src={topSrc || undefined}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              opacity: topOpacity,
              transform: `translate(${shiftX}px, ${shiftY}px) scale(${scale})`,
              transformOrigin: "center center",
            }}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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

            <label className="block text-xs">
              <span className="text-muted-foreground">Time offset (top = bottom + offset): {offsetSec.toFixed(2)}s</span>
              <input
                className="mt-1 w-full"
                type="range"
                min={-5}
                max={5}
                step={0.01}
                value={offsetSec}
                onChange={(e) => setOffsetSec(Number(e.target.value))}
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
                className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
                onClick={() => setOffsetSec((s) => clamp(s - nudgeMs / 1000, -30, 30))}
              >
                -{nudgeMs}ms
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
                onClick={() => setOffsetSec((s) => clamp(s + nudgeMs / 1000, -30, 30))}
              >
                +{nudgeMs}ms
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
                onClick={() => setOffsetSec(0)}
              >
                Reset offset
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground">
              Alignment controls (useful if the camera is “almost” identical).
            </div>
            <label className="block text-xs">
              <span className="text-muted-foreground">Top scale: {scale.toFixed(2)}×</span>
              <input
                className="mt-1 w-full"
                type="range"
                min={0.5}
                max={1.5}
                step={0.01}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Top shift X: {shiftX}px</span>
              <input
                className="mt-1 w-full"
                type="range"
                min={-200}
                max={200}
                step={1}
                value={shiftX}
                onChange={(e) => setShiftX(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">Top shift Y: {shiftY}px</span>
              <input
                className="mt-1 w-full"
                type="range"
                min={-200}
                max={200}
                step={1}
                value={shiftY}
                onChange={(e) => setShiftY(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
              onClick={() => {
                setScale(1);
                setShiftX(0);
                setShiftY(0);
              }}
            >
              Reset alignment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

