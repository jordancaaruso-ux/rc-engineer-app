/**
 * Run: `npx tsx --test src/lib/events/meetingNameLessTrack.test.ts`
 *
 * The share picture and the dashboard print a run's track and its meeting's name side by side, and
 * a new meeting's name starts with the track, so the track came out twice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingNameLessTrack } from "@/lib/events/meetingNameLessTrack";

test("a new meeting's own name loses the track it starts with", () => {
  // The name the New event form fills in (`defaultEventName`).
  assert.equal(meetingNameLessTrack("Indoor Raceway · Sat 26 Sep", "Indoor Raceway"), "Sat 26 Sep");
});

test("a meeting named just the track leaves nothing to add", () => {
  assert.equal(meetingNameLessTrack("Indoor Raceway", "Indoor Raceway"), null);
  assert.equal(meetingNameLessTrack("  indoor raceway ", "Indoor Raceway"), null);
});

test("case and the separator don't matter", () => {
  assert.equal(meetingNameLessTrack("INDOOR RACEWAY - Round 3", "Indoor Raceway"), "Round 3");
  assert.equal(meetingNameLessTrack("Indoor Raceway: Club Champs", "Indoor Raceway"), "Club Champs");
  assert.equal(meetingNameLessTrack("Indoor Raceway Winter Series", "Indoor Raceway"), "Winter Series");
  assert.equal(meetingNameLessTrack("Indoor Raceway | Sat 26 Sep", "Indoor Raceway"), "Sat 26 Sep");
});

test("a name that doesn't start with the whole track is kept whole", () => {
  assert.equal(meetingNameLessTrack("Indoor Raceways Cup", "Indoor Raceway"), "Indoor Raceways Cup");
  assert.equal(meetingNameLessTrack("Jim's Cup", "Jim"), "Jim's Cup");
  assert.equal(
    meetingNameLessTrack("Round 4 — NSW State Series", "Barton Park Raceway"),
    "Round 4 — NSW State Series"
  );
});

test("no meeting, or no track to take off", () => {
  assert.equal(meetingNameLessTrack(null, "Indoor Raceway"), null);
  assert.equal(meetingNameLessTrack("   ", "Indoor Raceway"), null);
  assert.equal(meetingNameLessTrack("Indoor Raceway · Sat 26 Sep", null), "Indoor Raceway · Sat 26 Sep");
  assert.equal(meetingNameLessTrack(" Club Champs ", ""), "Club Champs");
});
