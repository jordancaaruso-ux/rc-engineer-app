"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isMobileOverlayUi } from "@/components/videos/videoOverlayConstants";
import { syncBothPaused } from "@/components/videos/videoOverlayPlayback";
import {
  hardSeekTop,
  SYNC_HARD_SEEK_MOBILE_SEC,
  SYNC_HARD_SEEK_SEC,
  smoothSyncTopToBottom,
} from "@/components/videos/videoOverlaySync";

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
  /** When true, drift correction runs during playback. */
  isPlaying: boolean;
};

const PLAYBACK_SYNC_INTERVAL_MS = 100;

/**
 * Hybrid sync: hard seek when paused/scrubbing; during playback use rate nudge
 * with occasional hard seek when drift grows — smoother than per-frame locking.
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

  // Smooth drift correction while playing.
  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled || !isPlaying) return;

    top.muted = true;
    const hardSeekThreshold = isMobileOverlayUi() ? SYNC_HARD_SEEK_MOBILE_SEC : SYNC_HARD_SEEK_SEC;
    let rvfHandle: number | null = null;
    let intervalId = 0;
    let cancelled = false;
    let lastTickMs = 0;

    const tick = () => {
      if (cancelled || bottom.paused) return;
      const now = performance.now();
      if (now - lastTickMs < PLAYBACK_SYNC_INTERVAL_MS) return;
      lastTickMs = now;
      smoothSyncTopToBottom(bottom, top, offsetRef.current, hardSeekThreshold);
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
      intervalId = window.setInterval(tick, PLAYBACK_SYNC_INTERVAL_MS);
    }

    const onRateChange = () => {
      if (!bottom.paused) tick();
    };
    bottom.addEventListener("ratechange", onRateChange);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      if (rvfHandle != null && typeof bottomWithRvf.cancelVideoFrameCallback === "function") {
        bottomWithRvf.cancelVideoFrameCallback(rvfHandle);
      }
      bottom.removeEventListener("ratechange", onRateChange);
    };
  }, [bottomRef, topRef, enabled, isPlaying]);
}
