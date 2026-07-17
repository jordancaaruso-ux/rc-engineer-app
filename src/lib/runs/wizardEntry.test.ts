import assert from "node:assert/strict";
import test from "node:test";
import type { EntryCandidate } from "./entryCandidate";
import {
  CONTINUE_STALE_MS,
  deriveContinueEntry,
  deriveFreshEntry,
  isCandidateStale,
} from "./wizardEntry";

const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(overrides: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    runId: "run-1",
    carId: "car-1",
    carName: "A800RR",
    trackId: "track-1",
    trackName: "Boronia",
    eventId: null,
    eventName: null,
    eventEndIso: null,
    meetingSessionType: null,
    sessionLabel: null,
    whenIso: new Date().toISOString(),
    ...overrides,
  };
}

test("isCandidateStale flips at the 14-day boundary", () => {
  const now = Date.now();
  const recent = candidate({ whenIso: new Date(now - 13 * DAY_MS).toISOString() });
  const stale = candidate({ whenIso: new Date(now - CONTINUE_STALE_MS - DAY_MS).toISOString() });
  assert.equal(isCandidateStale(recent, now), false);
  assert.equal(isCandidateStale(stale, now), true);
});

test("continue: a deep-linked event wins outright", () => {
  const e = deriveContinueEntry(candidate({ trackId: "track-9" }), "event-deep");
  assert.equal(e.continuing, true);
  assert.equal(e.sessionType, "RACE_MEETING");
  assert.equal(e.eventId, "event-deep");
  // Track derives from the event, never the carried run.
  assert.equal(e.trackId, null);
});

test("continue: a race candidate's still-active event re-attaches", () => {
  const e = deriveContinueEntry(
    candidate({
      meetingSessionType: "QUALIFYING",
      eventId: "event-1",
      eventEndIso: new Date(Date.now() + DAY_MS).toISOString(),
    }),
    null,
  );
  assert.equal(e.sessionType, "RACE_MEETING");
  assert.equal(e.eventId, "event-1");
  assert.equal(e.trackId, null);
});

test("continue: an ended event carries only the track, as testing", () => {
  const e = deriveContinueEntry(
    candidate({
      meetingSessionType: "RACE",
      eventId: "event-1",
      eventEndIso: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    }),
    null,
  );
  assert.equal(e.sessionType, "TESTING");
  assert.equal(e.eventId, null);
  assert.equal(e.trackId, "track-1");
});

test("continue: a testing candidate carries its track", () => {
  const e = deriveContinueEntry(candidate(), null);
  assert.equal(e.sessionType, "TESTING");
  assert.equal(e.eventId, null);
  assert.equal(e.trackId, "track-1");
  assert.equal(e.carId, "car-1");
});

test("fresh: blank testing without an event; race practice with a deep link", () => {
  const blank = deriveFreshEntry("car-2", null);
  assert.equal(blank.continuing, false);
  assert.equal(blank.sessionType, "TESTING");
  assert.equal(blank.trackId, null);
  const linked = deriveFreshEntry("car-2", "event-deep");
  assert.equal(linked.sessionType, "RACE_MEETING");
  assert.equal(linked.eventId, "event-deep");
  assert.equal(linked.meetingSessionType, "PRACTICE");
});
