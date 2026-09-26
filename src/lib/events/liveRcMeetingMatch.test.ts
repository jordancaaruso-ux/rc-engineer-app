import assert from "node:assert/strict";
import { test } from "node:test";

import type { LiveRcEventListRow } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import {
  defaultEventName,
  isDefaultEventName,
  isLiveRcPlaceholder,
  liveRcMeetingForEvent,
  liveRcMeetingsOnDays,
  offeredLiveRcMeetings,
  shortDayLabel,
} from "@/lib/events/liveRcMeetingMatch";

const row = (eventId: string, startYmd: string, endYmd = startYmd, name = eventId): LiveRcEventListRow => ({
  eventHubUrl: `https://emcc.liverc.com/results/?p=view_event&id=${eventId}`,
  eventId,
  name,
  startYmd,
  endYmd,
  entries: null,
});

/** EMCC's LiveRC events page on 26 Sep 2026: the Cup running, five race days posted ahead. */
const EMCC = [
  row("cup", "2026-09-25", "2026-09-27", "EMCC CUP 25-27 Sept 2026"),
  row("r1110", "2026-10-11"),
  row("r2510", "2026-10-25"),
  row("r0811", "2026-11-08"),
  row("r1309", "2026-09-13"),
];

test("offers what is on today first, then the next week, then the last two weeks, and nothing further out", () => {
  const offered = offeredLiveRcMeetings(EMCC, "2026-09-26", 7);
  assert.deepEqual(
    offered.map((m) => [m.eventId, m.onToday]),
    [
      ["cup", true],
      ["r1309", false],
    ],
  );
  const month = offeredLiveRcMeetings(EMCC, "2026-09-26", 30);
  assert.deepEqual(
    month.map((m) => m.eventId),
    ["cup", "r1110", "r2510", "r1309"],
  );
  // 13 Sep is three weeks back from 4 Oct: gone.
  assert.deepEqual(
    offeredLiveRcMeetings(EMCC, "2026-10-04", 7).map((m) => m.eventId),
    ["r1110", "cup"],
  );
});

/** Indoor Raceway's LiveRC events page on 26 Sep 2026 (test drive W3-04). */
const INDOOR = [
  row("222", "2026-09-24", "2026-09-24", "Indoor Raceway - On Road Event 222"),
  row("template", "2022-01-11", "2030-01-11", "Template Event Copy Only Do Not Use"),
  row("export", "2022-01-16", "2030-01-16", "All Drivers For Exporting All Details Only"),
];

test("a row spanning years is a placeholder, never a meeting on today", () => {
  const offered = offeredLiveRcMeetings(INDOOR, "2026-09-26", 7);
  assert.deepEqual(
    offered.map((m) => [m.eventId, m.onToday]),
    [["222", false]],
  );
});

test("Thursday's meeting can still be picked on Saturday", () => {
  const offered = offeredLiveRcMeetings(INDOOR, "2026-09-26", 7);
  assert.equal(offered[0]!.name, "Indoor Raceway - On Road Event 222");
});

test("a hand-made meeting finds the real one even with placeholders overlapping every day", () => {
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-24", endYmd: "2026-09-24" }, INDOOR)?.eventId, "222");
  // A day with only the placeholders on it has no meeting to join.
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-26", endYmd: "2026-09-26" }, INDOOR), null);
});

test("the New event form finds LiveRC's meeting on the days picked, however far ahead", () => {
  // W1-10: Ethan typed "EMCC Cup" for Saturday 26 Sep and nothing pointed him to LiveRC's.
  assert.deepEqual(
    liveRcMeetingsOnDays(EMCC, "2026-09-26", "2026-09-26").map((m) => m.name),
    ["EMCC CUP 25-27 Sept 2026"],
  );
  // A race day posted a month ahead is found for its own day, not for the day before.
  assert.deepEqual(liveRcMeetingsOnDays(EMCC, "2026-10-25", "2026-10-25").map((m) => m.eventId), ["r2510"]);
  assert.deepEqual(liveRcMeetingsOnDays(EMCC, "2026-10-24", "2026-10-24"), []);
  // Placeholders never count, and a row listed twice is offered once.
  assert.deepEqual(liveRcMeetingsOnDays([...INDOOR, INDOOR[0]!], "2026-09-24", "2026-09-26").map((m) => m.eventId), ["222"]);
});

test("fourteen days is still a meeting; fifteen is a placeholder", () => {
  assert.equal(isLiveRcPlaceholder({ startYmd: "2026-09-01", endYmd: "2026-09-14" }), false);
  assert.equal(isLiveRcPlaceholder({ startYmd: "2026-09-01", endYmd: "2026-09-15" }), true);
  assert.equal(isLiveRcPlaceholder({ startYmd: "2026-09-26", endYmd: "2026-09-26" }), false);
});

test("a club day tomorrow is coming up, not on today", () => {
  const offered = offeredLiveRcMeetings([row("club", "2026-10-04")], "2026-10-03", 7);
  assert.equal(offered.length, 1);
  assert.equal(offered[0]!.onToday, false);
});

test("a meeting the page lists twice is offered once", () => {
  const offered = offeredLiveRcMeetings([row("a", "2026-09-26"), row("a", "2026-09-26")], "2026-09-26");
  assert.equal(offered.length, 1);
});

test("a hand-made event for the day finds the one meeting LiveRC posted later", () => {
  const rows = [row("ep", "2026-09-26", "2026-09-26", "EP Championship 26/09/26"), row("old", "2026-09-19")];
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-26", endYmd: "2026-09-26" }, rows)?.eventId, "ep");
});

test("a Saturday event matches a Friday-to-Sunday meeting, and a weekend event a Saturday one", () => {
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-26", endYmd: "2026-09-26" }, EMCC)?.eventId, "cup");
  const sat = [row("sat", "2026-09-26")];
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-25", endYmd: "2026-09-27" }, sat)?.eventId, "sat");
});

test("nothing on LiveRC for those dates leaves the event alone", () => {
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-20", endYmd: "2026-09-20" }, EMCC), null);
});

test("two meetings on the day is a guess, so no match (SA State Titles was listed twice)", () => {
  const rows = [
    row("titles-2026", "2026-09-11", "2026-09-11", "RCRA 2026 EP State Titles"),
    row("titles-2025", "2026-09-12", "2026-09-13", "RCRA 2025 EP State Titles"),
  ];
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-11", endYmd: "2026-09-13" }, rows), null);
  // One day of it is not ambiguous.
  assert.equal(liveRcMeetingForEvent({ startYmd: "2026-09-13", endYmd: "2026-09-13" }, rows)?.eventId, "titles-2025");
});

test("the placeholder name reads like the track and the day", () => {
  assert.equal(shortDayLabel("2026-09-26"), "Sat 26 Sep");
  assert.equal(shortDayLabel("2026-11-01"), "Sun 1 Nov");
  assert.equal(defaultEventName("Radio Racing Cars SA", "2026-09-26"), "Radio Racing Cars SA · Sat 26 Sep");
});

test("only a kept placeholder counts as default, under the track's old or new name", () => {
  const name = defaultEventName("Radio racing cars sa", "2026-09-26");
  assert.equal(isDefaultEventName(name, ["Radio Racing Cars SA", "Radio racing cars sa"]), true);
  assert.equal(isDefaultEventName(name, ["Radio Racing Cars SA"]), false);
  assert.equal(isDefaultEventName("Club champs R8", ["Radio Racing Cars SA"]), false);
  assert.equal(isDefaultEventName("Anything", [null, undefined, " "]), false);
});

test("a placeholder filled in for another day is still one nobody chose, so LiveRC's name replaces it", () => {
  // Test drive 2026-09-26: made before the name followed the dates, "Indoor Raceway · Sat 26 Sep"
  // sat on a meeting held Thursday the 24th and kept that name after joining LiveRC's.
  assert.equal(isDefaultEventName("Indoor Raceway · Sat 26 Sep", ["Indoor Raceway"]), true);
  assert.equal(isDefaultEventName(defaultEventName("Indoor Raceway", "2026-11-01"), ["Indoor Raceway"]), true);
  // Anything else after the track is a name somebody typed.
  assert.equal(isDefaultEventName("Indoor Raceway · Club night", ["Indoor Raceway"]), false);
  assert.equal(isDefaultEventName("Indoor Raceway · Sat 26 Sep round 2", ["Indoor Raceway"]), false);
  assert.equal(isDefaultEventName("Indoor Raceway · Sat 32 Sep", ["Indoor Raceway"]), false);
  assert.equal(isDefaultEventName("Indoor Raceway", ["Indoor Raceway"]), false);
  assert.equal(isDefaultEventName("Other Track · Sat 26 Sep", ["Indoor Raceway"]), false);
});
