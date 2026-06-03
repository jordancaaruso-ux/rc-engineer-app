const fs = require("fs");
let b = fs.readFileSync("src/app/api/new-run/bootstrap/route.ts", "utf8");
b = b.replace(
  `    prisma.track.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, location: true, liveRcUrl: true }
    })`,
  `    prisma.track.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        latitude: true,
        longitude: true,
        gripTags: true,
        layoutTags: true,
      },
    })`
);
fs.writeFileSync("src/app/api/new-run/bootstrap/route.ts", b);

const tests = `/**
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
`;
fs.writeFileSync("src/lib/trackLocationPrompt.test.ts", tests);

const pasteTests = `/**
 * Run: npx tsx src/lib/location/parseCoordinatesPaste.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCoordinatesPaste } from "@/lib/location/parseCoordinatesPaste";

test("parses comma-separated Google Maps paste", () => {
  const r = parseCoordinatesPaste("-37.75347382840569, 145.13890763862912");
  assert.ok(!("error" in r));
  assert.ok(Math.abs(r.latitude - -37.75347382840569) < 1e-6);
  assert.ok(Math.abs(r.longitude - 145.13890763862912) < 1e-6);
});

test("parses parentheses", () => {
  const r = parseCoordinatesPaste("(-37.75, 145.13)");
  assert.ok(!("error" in r));
});

test("rejects empty", () => {
  const r = parseCoordinatesPaste("  ");
  assert.ok("error" in r);
});
`;
fs.writeFileSync("src/lib/location/parseCoordinatesPaste.test.ts", pasteTests);
console.log("tests and bootstrap done");
