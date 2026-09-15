import test from "node:test";
import assert from "node:assert/strict";
import {
  debriefIdentityForGroup,
  eventIdFromMeetingKey,
  isValidMeetingKey,
  normalizeDebriefText,
} from "@/lib/debrief/debriefKey";

/**
 * A debrief hangs off the meeting the Sessions list forms, keyed exactly as that list keys
 * it. These pin the two things that would silently misfile a note: the DAY being resolved
 * in the reader's zone rather than the driver's, and the event id being read from anywhere
 * but the key.
 */

function run(id: string, at: string, opts?: { eventId?: string; zone?: string; track?: string }) {
  return {
    id,
    createdAt: new Date(at),
    sortAt: new Date(at),
    eventId: opts?.eventId ?? null,
    trackNameSnapshot: null,
    localTimeZone: opts?.zone ?? null,
    track: { name: opts?.track ?? "TFTR" },
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
