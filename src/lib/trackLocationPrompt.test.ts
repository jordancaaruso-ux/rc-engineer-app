/**
 * Run: `npx tsx src/lib/trackLocationPrompt.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";

test("prompts on first completed run when track has no coordinates", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    countCompletedRunsAtTrack: async () => 1,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: null,
      longitude: null,
    }),
  });
  assert.deepEqual(prompt, { trackId: "t1", trackName: "Test Track" });
});

test("skips when track already has coordinates", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    countCompletedRunsAtTrack: async () => 1,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: 51.5,
      longitude: -0.1,
    }),
  });
  assert.equal(prompt, null);
});

test("skips when not first completed run at track", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    countCompletedRunsAtTrack: async () => 2,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: null,
      longitude: null,
    }),
  });
  assert.equal(prompt, null);
});
