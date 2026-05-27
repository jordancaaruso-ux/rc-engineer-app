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
  /** When true, frame-lock loop runs during playback. */
  isPlaying: boolean;
};

/**
 * Frame-locked sync: top video follows bottom + offset every displayed frame.
 * Paused/scrubbing: hard seek on offset change and bottom seeked.
 */
export function useVideoOverlayFrameLockSync({
  bottomRef,
  topRef,
  offsetSec,
  playbackRate,
  enabled,
  isPlaying,
}: Params): void {
  const offsetRef = useRef(offsetSec);
  const rateRef = useRef(playbackRate);
  offsetRef.current = offsetSec;
  rateRef.current = playbackRate;

  // Immediate sync when offset changes (paused preview).
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;
    syncBothPaused(bottom, top, offsetSec, playbackRate);
  }, [bottomRef, topRef, offsetSec, playbackRate, enabled]);

  // Bottom timeline scrub → sync top.
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

  // Per-frame lock while playing.
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled || !isPlaying) return;

    top.muted = true;
    let rvfHandle: number | null = null;
    let rafHandle = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled || bottom.paused) return;
      frameLockTopToBottom(bottom, top, offsetRef.current);
    };

    const scheduleRaf = () => {
      if (cancelled || bottom.paused) return;
      tick();
      rafHandle = requestAnimationFrame(scheduleRaf);
    };

    const bottomWithRvf = bottom as VideoWithFrameCallback;
    if (typeof bottomWithRvf.requestVideoFrameCallback === "function") {
      const onFrame: VideoFrameRequestCallback = () => {
        if (cancelled || bottom.paused) return;
        tick();
        rvfHandle = bottomWithRvf.requestVideoFrameCallback!(onFrame);
      };
      rvfHandle = bottomWithRvf.requestVideoFrameCallback(onFrame);
    } else {
      rafHandle = requestAnimationFrame(scheduleRaf);
    }

    return () => {
      cancelled = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (rvfHandle != null && typeof bottomWithRvf.cancelVideoFrameCallback === "function") {
        bottomWithRvf.cancelVideoFrameCallback(rvfHandle);
      }
    };
  }, [bottomRef, topRef, enabled, isPlaying]);
}
