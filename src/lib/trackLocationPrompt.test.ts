/**
 * Run: npx tsx src/lib/trackLocationPrompt.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPromptMarkTrackLocation } from "@/lib/trackLocationPrompt";

test("prompts when track has no coordinates and not dismissed", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    hasDismissedRunLocationPrompt: async () => false,
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
    hasDismissedRunLocationPrompt: async () => false,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: 51.5,
      longitude: -0.1,
    }),
  });
  assert.equal(prompt, null);
});

test("skips when user dismissed modal for this track", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    hasDismissedRunLocationPrompt: async () => true,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: null,
      longitude: null,
    }),
  });
  assert.equal(prompt, null);
});

test("prompts on later complete when still unmarked and not dismissed", async () => {
  const prompt = await buildPromptMarkTrackLocation({
    userId: "u1",
    trackId: "t1",
    loggingComplete: true,
    newlyCompleted: true,
    hasDismissedRunLocationPrompt: async () => false,
    findTrack: async () => ({
      id: "t1",
      name: "Test Track",
      latitude: null,
      longitude: null,
    }),
  });
  assert.ok(prompt);
});
