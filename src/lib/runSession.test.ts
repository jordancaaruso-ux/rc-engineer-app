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
import { formatRunSessionDisplay, resolveDayRunNames, runSessionName } from "@/lib/runSession";
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

test("an imported label that already opens with the type word does not stutter", () => {
  // A timing provider's session name lands in `sessionLabel` verbatim, and it usually
  // starts with the type word: "Practice · Practice 3" is what the naive join produced.
  assert.equal(formatRunSessionDisplay(meeting("PRACTICE", null, "Practice 3")), "Practice 3");
  assert.equal(runSessionName(meeting("PRACTICE", null, "Practice 3")), "Practice 3");
  // The label wins outright — it carries the number the type part does not.
  assert.equal(runSessionName(meeting("QUALIFYING", "Q1", "Qualifier 3")), "Qualifying 1 · Qualifier 3");
  // Word boundary, not a bare prefix: "Practices" is a different word.
  assert.equal(formatRunSessionDisplay(meeting("PRACTICE", null, "Practices")), "Practice · Practices");
  // A label that says something else still rides after the name.
  assert.equal(formatRunSessionDisplay(meeting("PRACTICE", null, "Wet")), "Practice · Wet");
});

test("resolveDayRunNames: a name the day repeats becomes the run's position", () => {
  // The reported bug (2026-08-25): nothing stores a practice NUMBER, so a day of five
  // practice sessions named all five of them "Practice".
  const day = resolveDayRunNames([
    { name: "Practice", dayRunNumber: 1 },
    { name: "Practice", dayRunNumber: 2 },
    { name: "Practice", dayRunNumber: 3 },
  ]);
  assert.deepEqual(day.map((d) => d.label), ["Run 1", "Run 2", "Run 3"]);
  assert.deepEqual(day.map((d) => d.position), [1, 2, 3]);
});

test("resolveDayRunNames: unique names are left completely alone", () => {
  const day = resolveDayRunNames([
    { name: "Practice", dayRunNumber: 1 },
    { name: "Qualifying", dayRunNumber: 2 },
    { name: "A Main", dayRunNumber: 3 },
  ]);
  assert.deepEqual(day.map((d) => d.label), ["Practice", "Qualifying", "A Main"]);
  // No position, so a sentence built from these keeps its "Best run was …" shape.
  assert.deepEqual(day.map((d) => d.position), [null, null, null]);
});

test("resolveDayRunNames: only the repeated names move, not the whole day", () => {
  const day = resolveDayRunNames([
    { name: "Practice", dayRunNumber: 1 },
    { name: "Practice", dayRunNumber: 2 },
    { name: "A Main", dayRunNumber: 3 },
  ]);
  assert.deepEqual(day.map((d) => d.label), ["Run 1", "Run 2", "A Main"]);
});

test("resolveDayRunNames: a run ALREADY named by position reports itself as positional", () => {
  // Unlabeled testing runs arrive as "Run 2" from the formatter's own fallback. They are
  // unique, so nothing is rewritten — but the card must still say "run 2 of 3", not
  // "Best run was Run 2".
  const day = resolveDayRunNames([
    { name: "Run 1", dayRunNumber: 1 },
    { name: "Tyre test", dayRunNumber: 2 },
  ]);
  assert.deepEqual(day.map((d) => d.position), [1, null]);
});

test("resolveDayRunNames: the match ignores case and surrounding space", () => {
  const day = resolveDayRunNames([
    { name: "practice", dayRunNumber: 1 },
    { name: " Practice ", dayRunNumber: 2 },
  ]);
  assert.deepEqual(day.map((d) => d.label), ["Run 1", "Run 2"]);
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
