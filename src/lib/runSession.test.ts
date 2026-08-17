/**
 * Run: `npx tsx --test src/lib/runSession.test.ts`
 *
 * `runSessionName` is what a run ROW is titled with; `shortRunLabel` (tested in
 * analysisHomeModel.test.ts) is what the chart's x-axis tick says. The pair of
 * them is the whole point — these tests pin the split so a later "simplify"
 * can't quietly collapse them back into one string.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRunSessionDisplay, runSessionName } from "@/lib/runSession";
import { shortRunLabel } from "@/lib/analysis/analysisHomeModel";

const meeting = (
  meetingSessionType: string | null,
  meetingSessionCode: string | null,
  sessionLabel: string | null = null
) => ({
  sessionType: "RACE_MEETING",
  meetingSessionType,
  meetingSessionCode,
  sessionLabel,
});

test("runSessionName: the type label carries the code's number", () => {
  assert.equal(runSessionName(meeting("QUALIFYING", "Q2")), "Qualifying 2");
  assert.equal(runSessionName(meeting("RACE", "3")), "Race 3");
  assert.equal(runSessionName(meeting("PRACTICE", "1")), "Practice 1");
});

test("runSessionName: no code is just the type, not a dangling space", () => {
  assert.equal(runSessionName(meeting("SEEDING", null)), "Seeding");
  assert.equal(runSessionName(meeting("QUALIFYING", "  ")), "Qualifying");
});

test("runSessionName: a leading letter survives unless it is the type's own", () => {
  // "Q" is already said by "Qualifying" — dropping it avoids "Qualifying Q2".
  assert.equal(runSessionName(meeting("QUALIFYING", "Q2")), "Qualifying 2");
  // "A" is the A main. Stripping it would print the A and B mains identically.
  assert.equal(runSessionName(meeting("RACE", "A2")), "Race A2");
  assert.equal(runSessionName(meeting("RACE", "B2")), "Race B2");
  assert.notEqual(runSessionName(meeting("RACE", "A2")), runSessionName(meeting("RACE", "B2")));
});

test("runSessionName: OTHER puts the driver's own words through untouched", () => {
  assert.equal(runSessionName(meeting("OTHER", "Warm-up")), "Warm-up");
  assert.equal(runSessionName(meeting("OTHER", "Warm-up", "Wet")), "Warm-up · Wet");
});

test("runSessionName: a session label rides after the name", () => {
  assert.equal(runSessionName(meeting("QUALIFYING", "Q1", "Wet")), "Qualifying 1 · Wet");
});

test("runSessionName: testing takes its label, else the day's run number", () => {
  const testing = (sessionLabel: string | null) => ({
    sessionType: "TESTING",
    meetingSessionType: null,
    meetingSessionCode: null,
    sessionLabel,
  });
  assert.equal(runSessionName(testing("Tyre test")), "Tyre test");
  assert.equal(runSessionName(testing(null), { dayRunNumber: 4 }), "Run 4");
  assert.equal(runSessionName(testing(null)), "—");
  assert.equal(runSessionName(testing(null), { fallback: "Run" }), "Run");
});

test("runSessionName: a missing sessionType takes the testing branch", () => {
  // WorkbenchRunSource declares it optional so partial rows can pass straight in.
  assert.equal(runSessionName({ sessionLabel: "Shakedown" }), "Shakedown");
  assert.equal(runSessionName({}, { dayRunNumber: 2 }), "Run 2");
});

test("the x-axis label did NOT move — it is still the raw code", () => {
  // The whole reason runSessionName exists: the axis shares one row between
  // every run in the session and cannot hold "Qualifying 2".
  assert.equal(shortRunLabel(meeting("QUALIFYING", "Q2"), 0), "Q2");
  assert.equal(shortRunLabel(meeting("RACE", "3"), 5), "3");
  assert.equal(shortRunLabel({ meetingSessionCode: null, sessionLabel: null }, 2), "R3");
});

test("formatRunSessionDisplay is unchanged — other surfaces still read it", () => {
  // It deliberately drops the code for non-OTHER types; that is why the row
  // needed its own function rather than a widened version of this one.
  assert.equal(formatRunSessionDisplay(meeting("QUALIFYING", "Q2")), "Qualifying");
  assert.equal(formatRunSessionDisplay(meeting("OTHER", "Warm-up")), "Warm-up");
  assert.equal(formatRunSessionDisplay(meeting("QUALIFYING", "Q2", "Wet")), "Qualifying · Wet");
});
