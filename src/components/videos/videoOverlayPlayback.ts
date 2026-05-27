import {
  applyPlaybackRate,
  hardSeekTop,
  seekVideoTo,
} from "@/components/videos/videoOverlaySync";

const SEEK_WAIT_MS = 50;

function waitForTopSeeked(top: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (top.seeking) {
      const onSeeked = () => {
        top.removeEventListener("seeked", onSeeked);
        resolve();
      };
      top.addEventListener("seeked", onSeeked);
      window.setTimeout(() => {
        top.removeEventListener("seeked", onSeeked);
        resolve();
      }, SEEK_WAIT_MS);
      return;
    }
    resolve();
  });
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
  hardSeekTop(bottom, top, offsetSec);
}

/** Pause both videos. */
export function pauseBoth(bottom: HTMLVideoElement, top: HTMLVideoElement): void {
  bottom.pause();
  top.pause();
}

/**
 * Seek bottom, sync top, then start both in the same turn after top seek settles.
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
  hardSeekTop(bottom, top, offsetSec);
  await waitForTopSeeked(top);
  applyPlaybackRate(bottom, top, playbackRate);
  void bottom.play();
  void top.play();
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
