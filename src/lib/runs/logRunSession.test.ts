import assert from "node:assert/strict";
import test from "node:test";
import { defaultUiSession, uiSessionToMeeting } from "./logRunSession";
import type { EntryCandidate } from "./entryCandidate";

const cand = (over: Partial<EntryCandidate>): EntryCandidate => ({
  runId: "r1", carId: "c1", carName: "A800", trackId: "t1", trackName: "Boronia",
  eventId: null, eventName: null, eventEndIso: null, meetingSessionType: null, sessionLabel: null,
  whenIso: new Date(0).toISOString(), ...over,
});

test("non-event day → Testing implicit", () => {
  assert.deepEqual(defaultUiSession(cand({}), false, true), { type: "TESTING" });
});

test("event + continuing → defaults to the continued run's type", () => {
  assert.equal(defaultUiSession(cand({ meetingSessionType: "QUALIFYING" }), true, true).type, "QUALIFYING");
  const m = defaultUiSession(cand({ meetingSessionType: "RACE", sessionLabel: "B Main" }), true, true);
  assert.deepEqual(m, { type: "MAIN" });
});

test("event + fresh (not continuing) → Practice", () => {
  assert.equal(defaultUiSession(cand({ meetingSessionType: "RACE" }), true, false).type, "PRACTICE");
});

test("uiSessionToMeeting maps UI back to persisted fields", () => {
  assert.deepEqual(uiSessionToMeeting("MAIN"), { meetingSessionType: "RACE", sessionLabel: "Main" });
  assert.deepEqual(uiSessionToMeeting("QUALIFYING"), { meetingSessionType: "QUALIFYING", sessionLabel: null });
  assert.deepEqual(uiSessionToMeeting("TESTING"), { meetingSessionType: null, sessionLabel: null });
});
