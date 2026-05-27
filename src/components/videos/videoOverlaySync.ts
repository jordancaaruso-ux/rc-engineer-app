/** Pure sync helpers for dual-video overlay (no React). */

export function getSyncedTopTime(bottomTime: number, offsetSec: number): number {
  const target = bottomTime + offsetSec;
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, target);
}

type VideoWithFastSeek = HTMLVideoElement & { fastSeek?: (time: number) => void };

export function seekVideoTo(video: HTMLVideoElement, timeSec: number): void {
  const t = Math.max(0, timeSec);
  const v = video as VideoWithFastSeek;
  if (typeof v.fastSeek === "function") {
    try {
      v.fastSeek(t);
      return;
    } catch {
      // fall through
    }
  }
  video.currentTime = t;
}

export function hardSeekTop(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number
): void {
  seekVideoTo(top, getSyncedTopTime(bottom.currentTime, offsetSec));
}

export function applyPlaybackRate(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  rate: number
): void {
  bottom.playbackRate = rate;
  top.playbackRate = rate;
}

export function frameLockTopToBottom(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number
): void {
  const target = getSyncedTopTime(bottom.currentTime, offsetSec);
  if (Math.abs(top.currentTime - target) > 0.0001) {
    seekVideoTo(top, target);
  }
  if (top.playbackRate !== bottom.playbackRate) {
    top.playbackRate = bottom.playbackRate;
  }
}

export function isVideoBufferedForPlay(video: HTMLVideoElement): boolean {
  return video.readyState >= 3;
}
