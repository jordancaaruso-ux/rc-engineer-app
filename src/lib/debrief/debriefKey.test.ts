import test from "node:test";
import assert from "node:assert/strict";
import {
  debriefIdentityForGroup,
  eventIdFromMeetingKey,
  isValidMeetingKey,
  meetingIsOver,
  normalizeDebriefText,
} from "@/lib/debrief/debriefKey";

/**
 * A debrief hangs off the meeting the Sessions list forms, keyed exactly as that list keys
 * it. These pin the two things that would silently misfile a note: the DAY being resolved
 * in the reader's zone rather than the driver's, and the event id being read from anywhere
 * but the key.
 */

function run(
  id: string,
  at: string,
  opts?: {
    eventId?: string;
    zone?: string;
    track?: string;
    /** Declared meeting dates, as plain calendar days — how the Event row stores them. */
    eventDays?: { start: string; end: string };
  }
) {
  return {
    id,
    createdAt: new Date(at),
    sortAt: new Date(at),
    eventId: opts?.eventId ?? null,
    trackNameSnapshot: null,
    localTimeZone: opts?.zone ?? null,
    track: { name: opts?.track ?? "TFTR" },
    event: opts?.eventId
      ? {
          name: "Club titles",
          startDate: opts.eventDays ? new Date(`${opts.eventDays.start}T00:00:00Z`) : null,
          endDate: opts.eventDays ? new Date(`${opts.eventDays.end}T00:00:00Z`) : null,
          track: { name: opts?.track ?? "TFTR" },
          trackNameSnapshot: null,
        }
      : undefined,
  };
}

test("an eventless day keys on the driver's local day, not UTC", () => {
  // 01:30 on 20 Aug in Melbourne is still 19 Aug in UTC.
  const identity = debriefIdentityForGroup({
    id: "day-2026-08-20-name:tftr",
    runs: [run("r1", "2026-08-19T15:30:00Z", { zone: "Australia/Melbourne" })],
  });
  assert.ok(identity);
  assert.equal(identity.meetingKey, "day-2026-08-20-name:tftr");
  assert.equal(identity.eventId, null);
  assert.equal(identity.localDayKey, "2026-08-20");
  assert.equal(identity.trackKey, "name:tftr");
});

test("an event keys on its first day whichever run is listed first", () => {
  // Newest-first, as the Sessions group holds them.
  const identity = debriefIdentityForGroup({
    id: "event-evt_1",
    runs: [
      run("r3", "2026-09-13T04:00:00Z", { eventId: "evt_1", zone: "Australia/Brisbane" }),
      run("r2", "2026-09-12T06:00:00Z", { eventId: "evt_1", zone: "Australia/Brisbane" }),
      run("r1", "2026-09-12T01:00:00Z", { eventId: "evt_1", zone: "Australia/Brisbane" }),
    ],
  });
  assert.ok(identity);
  assert.equal(identity.eventId, "evt_1");
  assert.equal(identity.localDayKey, "2026-09-12");
});

test("a group with no runs has nothing to hang a debrief off", () => {
  assert.equal(debriefIdentityForGroup({ id: "day-2026-08-20-name:tftr", runs: [] }), null);
});

test("the event id comes from the key alone", () => {
  assert.equal(eventIdFromMeetingKey("event-abc_123"), "abc_123");
  assert.equal(eventIdFromMeetingKey("day-2026-08-20-name:tftr"), null);
});

test("meeting keys are the two shapes the Sessions list emits and nothing else", () => {
  assert.ok(isValidMeetingKey("event-cm1abc"));
  assert.ok(isValidMeetingKey("day-2026-08-20-name:tftr"));
  assert.ok(isValidMeetingKey("day-2026-08-20-no-track"));
  assert.equal(isValidMeetingKey("event-"), false);
  assert.equal(isValidMeetingKey("day-2026-8-20-name:tftr"), false);
  assert.equal(isValidMeetingKey("anything"), false);
  assert.equal(isValidMeetingKey(null), false);
});

test("an emptied box is null, and Windows newlines are folded", () => {
  assert.equal(normalizeDebriefText("  \n \r\n "), null);
  assert.equal(normalizeDebriefText(undefined), null);
  assert.equal(normalizeDebriefText("rear was loose\r\nall day  "), "rear was loose\nall day");
});

/**
 * Overview vs Debrief: the card's one word. A test day turns over at the driver's midnight, an
 * event when its last declared day has passed — both on the DRIVER's calendar, which is the
 * one thing here that can silently call a meeting finished an evening early.
 */

test("a test day is an overview while it is still that day, and over the next", () => {
  const group = {
    runs: [run("r1", "2026-09-16T04:00:00Z", { zone: "Australia/Melbourne" })],
  };
  // Same Melbourne day, later that evening.
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-16T11:00:00Z") }), false);
  // Past Melbourne midnight — 10:00 UTC on the 16th is already the 17th there.
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-16T14:30:00Z") }), true);
});

test("the driver's midnight decides it, not the reader's", () => {
  // A Sydney Saturday evening read from London is still Saturday at the track.
  const group = {
    runs: [run("r1", "2026-09-12T06:00:00Z", { zone: "Australia/Sydney" })],
  };
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-12T09:00:00Z") }), false);
});

test("an event stays an overview until its last declared day has passed", () => {
  const group = {
    runs: [
      run("r2", "2026-09-12T06:00:00Z", {
        eventId: "evt_1",
        zone: "Australia/Brisbane",
        eventDays: { start: "2026-09-12", end: "2026-09-13" },
      }),
    ],
  };
  // Saturday night, with Sunday still to run.
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-12T12:00:00Z") }), false);
  // Sunday itself.
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-13T06:00:00Z") }), false);
  // Monday in Brisbane.
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-14T00:00:00Z") }), true);
});

test("a run past the declared end keeps the meeting live", () => {
  // The event said it finished Sunday; a run landed on Monday. It is not over on Monday.
  const group = {
    runs: [
      run("r3", "2026-09-14T04:00:00Z", {
        eventId: "evt_1",
        zone: "Australia/Brisbane",
        eventDays: { start: "2026-09-12", end: "2026-09-13" },
      }),
    ],
  };
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-14T08:00:00Z") }), false);
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-15T08:00:00Z") }), true);
});

test("an event with no declared dates falls back to the day its runs landed on", () => {
  const group = {
    runs: [run("r1", "2026-09-12T06:00:00Z", { eventId: "evt_1", zone: "Australia/Brisbane" })],
  };
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-12T09:00:00Z") }), false);
  assert.equal(meetingIsOver(group, { now: new Date("2026-09-13T09:00:00Z") }), true);
});

test("a group with no runs has nothing live about it", () => {
  assert.equal(meetingIsOver({ runs: [] }), true);
});
