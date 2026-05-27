/**
 * Run: `npx tsx src/components/videos/videoOverlayConstants.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampOffset,
  formatOffset,
  MAX_OFFSET_SEC,
  parseOffset,
} from "@/components/videos/videoOverlayConstants";

test("clampOffset respects ±5 minute limit", () => {
  assert.equal(clampOffset(400), MAX_OFFSET_SEC);
  assert.equal(clampOffset(-400), -MAX_OFFSET_SEC);
  assert.equal(clampOffset(120), 120);
});

test("formatOffset and parseOffset round-trip mm:ss", () => {
  assert.equal(formatOffset(-125.5), "-2:05.50");
  assert.equal(parseOffset("-2:05.50"), -125.5);
  assert.equal(parseOffset("90"), 90);
});
