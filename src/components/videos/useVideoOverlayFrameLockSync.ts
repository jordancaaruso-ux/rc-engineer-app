"use client";

import { useEffect, useRef, type RefObject } from "react";
import { syncBothPaused } from "@/components/videos/videoOverlayPlayback";
import { frameLockTopToBottom, hardSeekTop } from "@/components/videos/videoOverlaySync";

type VideoFrameRequestCallback = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type Params = {
  bottomRef: RefObject<HTMLVideoElement | null>;
  topRef: RefObject<HTMLVideoElement | null>;
  offsetSec: number;
  playbackRate: number;
  enabled: boolean;
  /** @deprecated Sync loop follows bottom play/pause events directly. */
  isPlaying?: boolean;
};

const FALLBACK_SYNC_INTERVAL_MS = 16;

/**
 * Hard frame-lock sync: top follows bottom + offset every decoded frame.
 * Play/pause on the bottom element drives the correction loop (no React state lag).
 */
export function useVideoOverlayFrameLockSync({
  bottomRef,
  topRef,
  offsetSec,
  playbackRate,
  enabled,
}: Params): void {
  const offsetRef = useRef(offsetSec);
  const rateRef = useRef(playbackRate);
  offsetRef.current = offsetSec;
  rateRef.current = playbackRate;

  // Immediate hard sync when offset changes (paused preview).
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;
    syncBothPaused(bottom, top, offsetSec, playbackRate);
  }, [bottomRef, topRef, offsetSec, playbackRate, enabled]);

  // Bottom timeline scrub → hard sync top.
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;

    const onSeeked = () => {
      hardSeekTop(bottom, top, offsetRef.current);
      top.playbackRate = rateRef.current;
    };

    bottom.addEventListener("seeked", onSeeked);
    return () => bottom.removeEventListener("seeked", onSeeked);
  }, [bottomRef, topRef, enabled]);

  // Per-frame lock while bottom is playing.
  useEffect(() => {
    const bottom = bottomRef.current;
    if (!bottom || !enabled) return;

    let rvfHandle: number | null = null;
    let intervalId = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || bottom.paused) return;
      const top = topRef.current;
      if (!top) return;
      top.muted = true;
      frameLockTopToBottom(bottom, top, offsetRef.current);
    };

    const stopLoop = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = 0;
      }
      const bottomWithRvf = bottom as VideoWithFrameCallback;
      if (rvfHandle != null && typeof bottomWithRvf.cancelVideoFrameCallback === "function") {
        bottomWithRvf.cancelVideoFrameCallback(rvfHandle);
        rvfHandle = null;
      }
    };

    const startLoop = () => {
      if (cancelled) return;
      stopLoop();
      tick();

      const bottomWithRvf = bottom as VideoWithFrameCallback;
      if (typeof bottomWithRvf.requestVideoFrameCallback === "function") {
        const onFrame: VideoFrameRequestCallback = () => {
          if (cancelled || bottom.paused) return;
          tick();
          rvfHandle = bottomWithRvf.requestVideoFrameCallback!(onFrame);
        };
        rvfHandle = bottomWithRvf.requestVideoFrameCallback(onFrame);
      } else {
        intervalId = window.setInterval(tick, FALLBACK_SYNC_INTERVAL_MS);
      }
    };

    const onPlay = () => startLoop();
    const onPause = () => stopLoop();
    const onEnded = () => stopLoop();

    bottom.addEventListener("play", onPlay);
    bottom.addEventListener("pause", onPause);
    bottom.addEventListener("ended", onEnded);

    if (!bottom.paused) startLoop();

    return () => {
      cancelled = true;
      stopLoop();
      bottom.removeEventListener("play", onPlay);
      bottom.removeEventListener("pause", onPause);
      bottom.removeEventListener("ended", onEnded);
    };
  }, [bottomRef, topRef, enabled]);
}
