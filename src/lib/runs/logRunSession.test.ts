import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultUiSession,
  followDateEventName,
  linkedMeetingNotice,
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

test("followDateEventName: the filled-in name follows the first day, a typed one stays", () => {
  const auto = "RC Madness · Sat 26 Sep";
  assert.equal(
    followDateEventName({ name: auto, autoName: auto, trackName: "RC Madness", startYmd: "2026-09-20" }),
    "RC Madness · Sun 20 Sep"
  );
  // Typed over, or never filled in: the driver's name is left alone.
  assert.equal(
    followDateEventName({ name: "Club champs", autoName: auto, trackName: "RC Madness", startYmd: "2026-09-20" }),
    null
  );
  assert.equal(
    followDateEventName({ name: "", autoName: null, trackName: "RC Madness", startYmd: "2026-09-20" }),
    null
  );
  // Same day, or no track to name it after: nothing to change.
  assert.equal(
    followDateEventName({ name: auto, autoName: auto, trackName: "RC Madness", startYmd: "2026-09-26" }),
    null
  );
  assert.equal(followDateEventName({ name: auto, autoName: auto, trackName: " ", startYmd: "2026-09-20" }), null);
});

test("linkedMeetingNotice names both meetings, and falls back when a name isn't known", () => {
  assert.equal(
    linkedMeetingNotice([{ fromName: "EMCC Cup", intoName: "EMCC CUP 25-27 Sept 2026" }]),
    "Your meeting “EMCC Cup” joined LiveRC’s “EMCC CUP 25-27 Sept 2026”."
  );
  assert.equal(
    linkedMeetingNotice([{ fromName: null, intoName: "EMCC CUP 25-27 Sept 2026" }]),
    "Your meeting joined LiveRC’s “EMCC CUP 25-27 Sept 2026”."
  );
  assert.equal(
    linkedMeetingNotice([{ fromName: "EMCC Cup", intoName: null }]),
    "Your meeting “EMCC Cup” joined its LiveRC meeting."
  );
  assert.equal(
    linkedMeetingNotice([
      { fromName: "A", intoName: "B" },
      { fromName: "C", intoName: "D" },
    ]),
    "2 of your meetings joined their LiveRC meetings."
  );
  assert.equal(linkedMeetingNotice([]), null);
});
