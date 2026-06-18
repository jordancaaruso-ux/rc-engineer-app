import {
  applyPlaybackRate,
  frameLockTopToBottom,
  hardSeekTop,
  isVideoBufferedForPlay,
  seekVideoTo,
} from "@/components/videos/videoOverlaySync";

const SEEK_WAIT_MS = 250;
const PLAYING_WAIT_MS = 3000;

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: "seeked" | "playing",
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve) => {
    if (eventName === "seeked" && !video.seeking) {
      resolve();
      return;
    }
    if (eventName === "playing" && !video.paused && video.readyState >= 2) {
      resolve();
      return;
    }

    const onEvent = () => {
      cleanup();
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      window.clearTimeout(timer);
    };
    video.addEventListener(eventName, onEvent);
  });
}

export function areBothBufferedForPlay(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement
): boolean {
  return isVideoBufferedForPlay(bottom) && isVideoBufferedForPlay(top);
}

/** Pause both and align top to bottom + offset (no play). */
export function syncBothPaused(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number,
  playbackRate: number
): void {
  top.muted = true;
  applyPlaybackRate(bottom, top, playbackRate);
  frameLockTopToBottom(bottom, top, offsetSec);
}

/** Pause both videos. */
export function pauseBoth(bottom: HTMLVideoElement, top: HTMLVideoElement): void {
  bottom.pause();
  top.pause();
}

/**
 * Seek bottom, sync top, then start both with a tight play-start handshake.
 */
export async function playBothSynced(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number,
  playbackRate: number
): Promise<void> {
  pauseBoth(bottom, top);
  top.muted = true;
  applyPlaybackRate(bottom, top, playbackRate);
  frameLockTopToBottom(bottom, top, offsetSec);
  await waitForMediaEvent(top, "seeked", SEEK_WAIT_MS);
  applyPlaybackRate(bottom, top, playbackRate);

  await Promise.allSettled([bottom.play(), top.play()]);

  await Promise.all([
    waitForMediaEvent(bottom, "playing", PLAYING_WAIT_MS),
    waitForMediaEvent(top, "playing", PLAYING_WAIT_MS),
  ]);

  frameLockTopToBottom(bottom, top, offsetSec);
  applyPlaybackRate(bottom, top, playbackRate);
}

/** Seek bottom to time and sync top while paused. */
export function seekBottomAndSync(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  timeSec: number,
  offsetSec: number,
  playbackRate: number
): void {
  pauseBoth(bottom, top);
  seekVideoTo(bottom, timeSec);
  applyPlaybackRate(bottom, top, playbackRate);
  hardSeekTop(bottom, top, offsetSec);
}

/** Seek both to start (bottom 0, top at offset). */
export function jumpToStart(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number,
  playbackRate: number
): void {
  seekBottomAndSync(bottom, top, 0, offsetSec, playbackRate);
}
