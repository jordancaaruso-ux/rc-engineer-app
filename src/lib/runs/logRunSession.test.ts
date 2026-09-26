import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultUiSession,
  meetingSessionKind,
  uiSessionToMeeting,
} from "./logRunSession";
import type { EntryCandidate } from "./entryCandidate";

const cand = (over: Partial<EntryCandidate>): EntryCandidate => ({
  runId: "r1", carId: "c1", carName: "A800", trackId: "t1", trackName: "Boronia",
  eventId: null, eventName: null, eventEndIso: null, sessionType: null, meetingSessionType: null, sessionLabel: null,
  whenIso: new Date(0).toISOString(), ...over,
});

test("non-event day → Testing implicit", () => {
  assert.deepEqual(defaultUiSession(cand({}), false, true), { type: "TESTING" });
});

test("event + continuing → defaults to the continued run's type", () => {
  assert.equal(defaultUiSession(cand({ meetingSessionType: "QUALIFYING" }), true, true).type, "QUALIFYING");
  assert.equal(defaultUiSession(cand({ meetingSessionType: "SEEDING" }), true, true).type, "SEEDING");
  // A copied race stays a race: it used to turn into "Main", which no Session button offers.
  const m = defaultUiSession(cand({ meetingSessionType: "RACE", sessionLabel: "B Main" }), true, true);
  assert.deepEqual(m, { type: "RACE" });
  // "Something else…" can't be carried without its own words.
  assert.equal(defaultUiSession(cand({ meetingSessionType: "OTHER" }), true, true).type, "PRACTICE");
});

test("event + fresh (not continuing) → Practice", () => {
  assert.equal(defaultUiSession(cand({ meetingSessionType: "RACE" }), true, false).type, "PRACTICE");
});

test("uiSessionToMeeting maps UI back to persisted fields", () => {
  // A race saves no invented label; its own label rides along when it had one.
  assert.deepEqual(uiSessionToMeeting("RACE"), { meetingSessionType: "RACE", sessionLabel: null });
  assert.deepEqual(uiSessionToMeeting("RACE", "A Main"), { meetingSessionType: "RACE", sessionLabel: "A Main" });
  // A label qualifies a race, never another type.
  assert.deepEqual(uiSessionToMeeting("QUALIFYING", "A Main"), { meetingSessionType: "QUALIFYING", sessionLabel: null });
  assert.deepEqual(uiSessionToMeeting("SEEDING"), { meetingSessionType: "SEEDING", sessionLabel: null });
  assert.deepEqual(uiSessionToMeeting("TESTING"), { meetingSessionType: null, sessionLabel: null });
});

test("meetingSessionKind: the ticked button's word leads, a race's own label follows", () => {
  assert.equal(meetingSessionKind("RACE", null), "Race");
  assert.equal(meetingSessionKind("RACE", "A Main"), "Race · A Main");
  assert.equal(meetingSessionKind("RACE", "Race 3"), "Race 3");
  assert.equal(meetingSessionKind("SEEDING"), "Seeding");
  assert.equal(meetingSessionKind(null), "Practice");
});
