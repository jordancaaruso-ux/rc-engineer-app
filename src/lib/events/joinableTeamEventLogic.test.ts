import test from "node:test";
import assert from "node:assert/strict";
import {
  addDaysToYmd,
  rankJoinableTeamEvents,
  type JoinableEventCandidate,
} from "@/lib/events/joinableTeamEventLogic";

/**
 * Local noon, deliberately not `Date.UTC` — "today" is a local calendar day, and building the
 * reference in UTC would make these assertions pass or fail depending on the machine's timezone.
 */
const TODAY = new Date(2026, 7, 19, 12, 0, 0);

function ev(
  id: string,
  startYmd: string,
  endYmd: string,
  resultsSourceUrl: string | null = null
): JoinableEventCandidate {
  return {
    id,
    name: `Event ${id}`,
    startDate: new Date(`${startYmd}T12:00:00Z`),
    endDate: new Date(`${endYmd}T12:00:00Z`),
    resultsSourceUrl,
    userId: "mate",
  };
}

test("addDaysToYmd crosses a month boundary", () => {
  assert.equal(addDaysToYmd("2026-08-19", 7), "2026-08-26");
  assert.equal(addDaysToYmd("2026-08-28", 7), "2026-09-04");
});

test("an event on today is offered", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("a", "2026-08-19", "2026-08-19")],
    referenceDate: TODAY,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.isOnToday, true);
});

test("a teammate's event later this week is offered, and flagged as not on today", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("sat", "2026-08-22", "2026-08-23")],
    referenceDate: TODAY,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "sat");
  assert.equal(out[0]!.isOnToday, false);
});

test("past and beyond-the-window events are dropped", () => {
  const out = rankJoinableTeamEvents({
    candidates: [
      ev("yesterday", "2026-08-18", "2026-08-18"),
      ev("next-month", "2026-09-20", "2026-09-21"),
    ],
    referenceDate: TODAY,
  });
  assert.deepEqual(out.map((e) => e.id), []);
});

/**
 * The bug this whole change exists to kill: a teammate's event was skipped purely because they had
 * pasted a results link into it, even when no timing site was involved in the question.
 */
test("with no hub known, an event carrying a results URL is still offered", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("a", "2026-08-19", "2026-08-19", "https://x.liverc.com/?p=view_event&id=99")],
    referenceDate: TODAY,
  });
  assert.deepEqual(out.map((e) => e.id), ["a"]);
});

test("with a hub known, an event claiming a different meeting is dropped and a match survives", () => {
  const out = rankJoinableTeamEvents({
    candidates: [
      ev("other", "2026-08-19", "2026-08-19", "https://x.liverc.com/?p=view_event&id=11"),
      ev("same", "2026-08-19", "2026-08-19", "https://x.liverc.com/?p=view_event&id=22"),
      ev("unclaimed", "2026-08-19", "2026-08-19"),
    ],
    referenceDate: TODAY,
    eventHubUrl: "https://x.liverc.com/?p=view_event&id=22#anything",
  });
  assert.deepEqual(out.map((e) => e.id).sort(), ["same", "unclaimed"]);
});

test("on now beats booked for the weekend", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("sat", "2026-08-22", "2026-08-23"), ev("now", "2026-08-19", "2026-08-19")],
    referenceDate: TODAY,
  });
  assert.deepEqual(out.map((e) => e.id), ["now", "sat"]);
});

test("among equals, the event still waiting for a results URL leads", () => {
  const out = rankJoinableTeamEvents({
    candidates: [
      ev("claimed", "2026-08-19", "2026-08-19", "https://x.liverc.com/?p=view_event&id=7"),
      ev("open", "2026-08-19", "2026-08-19"),
    ],
    referenceDate: TODAY,
  });
  assert.deepEqual(out.map((e) => e.id), ["open", "claimed"]);
});

/** Race morning east of Greenwich: local 19th, UTC 18th. The event is on NOW. */
test("an early local morning still counts as the same calendar day", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("a", "2026-08-19", "2026-08-19")],
    referenceDate: new Date(2026, 7, 19, 7, 30, 0),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.isOnToday, true);
});

test("a multi-day event already under way counts as on today", () => {
  const out = rankJoinableTeamEvents({
    candidates: [ev("weekender", "2026-08-17", "2026-08-20")],
    referenceDate: TODAY,
  });
  assert.equal(out[0]!.isOnToday, true);
});
