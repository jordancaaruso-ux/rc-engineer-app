/** Pure sync helpers for dual-video overlay (no React). */

/** Start rate nudge when drift exceeds this (seconds). */
export const SYNC_SOFT_DRIFT_SEC = 0.05;
/** Hard seek when drift exceeds this on desktop (seconds). */
export const SYNC_HARD_SEEK_SEC = 0.22;
/** Hard seek when drift exceeds this on mobile (seconds). */
export const SYNC_HARD_SEEK_MOBILE_SEC = 0.32;
/** Playback-rate multiplier while catching up / slowing down. */
export const SYNC_NUDGE_FACTOR = 1.02;

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

export type SyncDriftAction =
  | { type: "seek"; targetTime: number; playbackRate: number }
  | { type: "nudge"; playbackRate: number }
  | { type: "match"; playbackRate: number };

/** Decide how to correct top drift without forcing a seek every frame. */
export function getSyncDriftAction(
  topTime: number,
  bottomTime: number,
  offsetSec: number,
  bottomPlaybackRate: number,
  hardSeekThresholdSec: number,
  softDriftSec: number = SYNC_SOFT_DRIFT_SEC,
  nudgeFactor: number = SYNC_NUDGE_FACTOR
): SyncDriftAction {
  const target = getSyncedTopTime(bottomTime, offsetSec);
  const drift = target - topTime;
  const abs = Math.abs(drift);
  const baseRate = bottomPlaybackRate;

  if (abs > hardSeekThresholdSec) {
    return { type: "seek", targetTime: target, playbackRate: baseRate };
  }
  if (abs > softDriftSec) {
    return {
      type: "nudge",
      playbackRate: drift > 0 ? baseRate * nudgeFactor : baseRate / nudgeFactor,
    };
  }
  return { type: "match", playbackRate: baseRate };
}

export function applySyncDriftAction(top: HTMLVideoElement, action: SyncDriftAction): void {
  if (action.type === "seek") {
    seekVideoTo(top, action.targetTime);
    top.playbackRate = action.playbackRate;
    return;
  }
  top.playbackRate = action.playbackRate;
}

/** Hard frame lock — use when paused or before play. */
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

/**
 * Smooth playback sync: rate nudge for small drift, hard seek only when far off.
 * Keeps the overlay decode pipeline running instead of seeking every frame.
 */
export function smoothSyncTopToBottom(
  bottom: HTMLVideoElement,
  top: HTMLVideoElement,
  offsetSec: number,
  hardSeekThresholdSec: number
): void {
  if (top.seeking) return;

  const action = getSyncDriftAction(
    top.currentTime,
    bottom.currentTime,
    offsetSec,
    bottom.playbackRate,
    hardSeekThresholdSec
  );
  applySyncDriftAction(top, action);
}

export function isVideoBufferedForPlay(video: HTMLVideoElement): boolean {
  return video.readyState >= 3;
}
