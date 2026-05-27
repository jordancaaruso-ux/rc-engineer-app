"use client";

import { useEffect, useRef, type RefObject } from "react";
import { isMobileOverlayUi } from "@/components/videos/videoOverlayConstants";

export function hardSeekTopToOffset(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number
): void {
  const target = bottom.currentTime + offsetSec;
  if (!Number.isFinite(target)) return;
  top.currentTime = Math.max(0, target);
  top.playbackRate = bottom.playbackRate;
}

type Params = {
  bottomRef: RefObject<HTMLVideoElement | null>;
  topRef: RefObject<HTMLVideoElement | null>;
  offsetSec: number;
  enabled: boolean;
};

/**
 * Keeps top video in sync with bottom + offset. Hard-seeks on play/pause/seek;
 * during playback uses ~10Hz drift correction (playbackRate nudge, rare seeks).
 */
export function useVideoOverlaySync({ bottomRef, topRef, offsetSec, enabled }: Params): void {
  const offsetRef = useRef(offsetSec);
  offsetRef.current = offsetSec;

  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;

    const hardSeek = () => hardSeekTopToOffset(bottom, top, offsetRef.current);

    const onPlay = () => {
      top.muted = true;
      top.playbackRate = bottom.playbackRate;
      hardSeek();
      top.play().catch(() => {});
    };
    const onPause = () => {
      top.pause();
      top.playbackRate = bottom.playbackRate;
    };
    const onRate = () => {
      top.playbackRate = bottom.playbackRate;
    };

    bottom.addEventListener("play", onPlay);
    bottom.addEventListener("pause", onPause);
    bottom.addEventListener("ratechange", onRate);
    bottom.addEventListener("seeked", hardSeek);
    bottom.addEventListener("seeking", hardSeek);

    return () => {
      bottom.removeEventListener("play", onPlay);
      bottom.removeEventListener("pause", onPause);
      bottom.removeEventListener("ratechange", onRate);
      bottom.removeEventListener("seeked", hardSeek);
      bottom.removeEventListener("seeking", hardSeek);
    };
  }, [bottomRef, topRef, enabled]);

  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;
    hardSeekTopToOffset(bottom, top, offsetSec);
  }, [bottomRef, topRef, offsetSec, enabled]);

  useEffect(() => {
    const bottom = bottomRef.current;
    const top = topRef.current;
    if (!bottom || !top || !enabled) return;

    const mobile = isMobileOverlayUi();
    const hardSeekThreshold = mobile ? 0.35 : 0.25;

    const id = window.setInterval(() => {
      if (bottom.paused || top.paused) return;
      const target = bottom.currentTime + offsetRef.current;
      if (!Number.isFinite(target)) return;

      const drift = target - top.currentTime;
      const abs = Math.abs(drift);

      if (abs > hardSeekThreshold) {
        top.currentTime = Math.max(0, target);
        top.playbackRate = bottom.playbackRate;
        return;
      }

      if (abs > 0.04) {
        top.playbackRate = drift > 0 ? bottom.playbackRate * 1.02 : bottom.playbackRate * 0.98;
        return;
      }

      if (top.playbackRate !== bottom.playbackRate) {
        top.playbackRate = bottom.playbackRate;
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [bottomRef, topRef, enabled]);
}
