/**
 * Run: `npx tsx src/components/videos/videoOverlaySync.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSyncedTopTime,
  getSyncDriftAction,
  isVideoBufferedForPlay,
  SYNC_HARD_SEEK_SEC,
  SYNC_SOFT_DRIFT_SEC,
} from "@/components/videos/videoOverlaySync";
import { clampOffset, formatOffset, parseOffset } from "@/components/videos/videoOverlayConstants";

test("getSyncedTopTime adds offset and clamps at zero", () => {
  assert.equal(getSyncedTopTime(10, 2.5), 12.5);
  assert.equal(getSyncedTopTime(1, -5), 0);
});

test("parseOffset and clampOffset respect five minute limit", () => {
  assert.equal(parseOffset("-2:30"), -150);
  assert.equal(clampOffset(400), 300);
});

test("formatOffset displays signed mm:ss", () => {
  assert.equal(formatOffset(-125.5), "-2:05.50");
});

test("isVideoBufferedForPlay checks readyState", () => {
  assert.equal(isVideoBufferedForPlay({ readyState: 2 } as HTMLVideoElement), false);
  assert.equal(isVideoBufferedForPlay({ readyState: 3 } as HTMLVideoElement), true);
});

test("getSyncDriftAction nudges small drift and hard-seeks large drift", () => {
  const match = getSyncDriftAction(10, 10.03, 0, 1, SYNC_HARD_SEEK_SEC, SYNC_SOFT_DRIFT_SEC);
  assert.equal(match.type, "match");
  assert.equal(match.playbackRate, 1);

  const nudge = getSyncDriftAction(10, 10.12, 0, 1, SYNC_HARD_SEEK_SEC, SYNC_SOFT_DRIFT_SEC);
  assert.equal(nudge.type, "nudge");
  assert.ok(nudge.playbackRate > 1);

  const seek = getSyncDriftAction(10, 10.5, 0, 1, SYNC_HARD_SEEK_SEC, SYNC_SOFT_DRIFT_SEC);
  assert.equal(seek.type, "seek");
  assert.equal(seek.targetTime, 10.5);
});
