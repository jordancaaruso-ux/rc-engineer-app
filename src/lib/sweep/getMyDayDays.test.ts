import test from "node:test";
import assert from "node:assert/strict";
import {
  dayBoundsForYmd,
  daysFromToday,
  daysInRange,
  earliestReachableYmd,
  isValidYmd,
  recentDayChoices,
  splitDayCandidates,
} from "@/lib/sweep/getMyDayDays";

const SYD = "Australia/Sydney";

test("the pills are today and yesterday, in the zone's calendar", () => {
  const noonTuesdaySydney = new Date("2026-09-15T02:00:00Z");
  assert.deepEqual(recentDayChoices(noonTuesdaySydney, SYD), [
    { ymd: "2026-09-15", label: "Today" },
    { ymd: "2026-09-14", label: "Yesterday" },
  ]);
});

test("the days roll back across a month end", () => {
  const out = recentDayChoices(new Date("2026-10-02T02:00:00Z"), SYD, 5).map((d) => d.ymd);
  assert.deepEqual(out, ["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29", "2026-09-28"]);
});

test("the calendar reaches back a fortnight, counting today, and rolls across a month end", () => {
  assert.equal(earliestReachableYmd(new Date("2026-09-15T02:00:00Z"), SYD), "2026-09-02");
  assert.equal(earliestReachableYmd(new Date("2026-10-02T02:00:00Z"), SYD), "2026-09-19");
  // The zone decides which day "today" is before the counting starts.
  assert.equal(earliestReachableYmd(new Date("2026-09-14T15:00:00Z"), SYD), "2026-09-02");
  assert.equal(earliestReachableYmd(new Date("2026-09-14T15:00:00Z"), "Europe/London"), "2026-09-01");
});

test("a range reads newest day first, and one day is one day", () => {
  assert.deepEqual(daysInRange("2026-09-12", "2026-09-15"), [
    "2026-09-15",
    "2026-09-14",
    "2026-09-13",
    "2026-09-12",
  ]);
  assert.deepEqual(daysInRange("2026-09-15", "2026-09-15"), ["2026-09-15"]);
});

test("a range spans a month end, reads the same back to front, and refuses a non-date", () => {
  assert.deepEqual(daysInRange("2026-09-29", "2026-10-01"), ["2026-10-01", "2026-09-30", "2026-09-29"]);
  assert.deepEqual(daysInRange("2026-09-15", "2026-09-12"), daysInRange("2026-09-12", "2026-09-15"));
  assert.deepEqual(daysInRange("not-a-day", "2026-09-15"), []);
  // A range the calendar cannot offer must not spin the sheet for ever.
  assert.equal(daysInRange("2020-01-01", "2026-09-15").length, 60);
});

test("a range across a daylight-saving change keeps one entry per calendar day", () => {
  // Sydney's clocks go forward on 4 October 2026; the 4th is a 23-hour day.
  assert.deepEqual(daysInRange("2026-10-03", "2026-10-05"), ["2026-10-05", "2026-10-04", "2026-10-03"]);
});

test("'today' is the zone's today, not the server's", () => {
  // 01:00 on the 15th in Sydney is 16:00 on the 14th in London.
  const at = new Date("2026-09-14T15:00:00Z");
  assert.equal(recentDayChoices(at, SYD)[0]!.ymd, "2026-09-15");
  assert.equal(recentDayChoices(at, "Europe/London")[0]!.ymd, "2026-09-14");
});

test("a day runs midnight to midnight at the track, 23 hours when the clocks go forward", () => {
  const plain = dayBoundsForYmd("2026-09-15", SYD);
  assert.equal(plain.start.toISOString(), "2026-09-14T14:00:00.000Z");
  assert.equal(plain.end.toISOString(), "2026-09-15T14:00:00.000Z");
  const dst = dayBoundsForYmd("2026-10-04", SYD);
  assert.equal(dst.start.toISOString(), "2026-10-03T14:00:00.000Z");
  assert.equal(dst.end.toISOString(), "2026-10-04T13:00:00.000Z");
});

test("days from today, and strings that are not dates", () => {
  const now = new Date("2026-09-15T02:00:00Z");
  assert.equal(daysFromToday("2026-09-15", now, SYD), 0);
  assert.equal(daysFromToday("2026-09-13", now, SYD), -2);
  assert.equal(daysFromToday("2026-09-16", now, SYD), 1);
  assert.equal(daysFromToday("2026-02-30", now, SYD), null);
  assert.equal(daysFromToday("15/09/2026", now, SYD), null);
  assert.equal(isValidYmd("2026-09-15"), true);
  assert.equal(isValidYmd(20260915), false);
});

test("LiveRC sessions sit on their own date, and already-logged ones are counted apart", () => {
  const rows = [
    { sessionUrl: "https://t.liverc.com/a", sessionCompletedAtIso: "2026-09-13T09:25:00.000Z", linkedRunId: null },
    { sessionUrl: "https://t.liverc.com/b", sessionCompletedAtIso: "2026-09-13T23:50:00.000Z", linkedRunId: "run1" },
    { sessionUrl: "https://t.liverc.com/c", sessionCompletedAtIso: "2026-09-14T08:00:00.000Z", linkedRunId: null },
    { sessionUrl: "https://t.liverc.com/a", sessionCompletedAtIso: "2026-09-13T09:25:00.000Z", linkedRunId: null },
    { sessionUrl: "https://t.liverc.com/d", sessionCompletedAtIso: null, linkedRunId: null },
  ];
  const out = splitDayCandidates(rows, "2026-09-13", "liverc", SYD);
  assert.deepEqual(out.toFile.map((c) => c.sessionUrl), ["https://t.liverc.com/a"]);
  assert.equal(out.alreadyOnRuns, 1);
});

test("Speedhive practice runs are placed on the day in the track's zone, not by their UTC date", () => {
  const loop = (id: string) => `https://speedhive.mylaps.com/practice/4591/activities/${id}`;
  const rows = [
    // 08:30 on the 13th in Sydney.
    { sessionUrl: loop("8"), sessionCompletedAtIso: "2026-09-12T22:30:00.000Z", linkedRunId: null },
    // 00:30 on the 14th in Sydney, whatever its UTC date says.
    { sessionUrl: loop("9"), sessionCompletedAtIso: "2026-09-13T14:30:00.000Z", linkedRunId: null },
  ];
  const out = splitDayCandidates(rows, "2026-09-13", "speedhive", SYD);
  assert.deepEqual(out.toFile.map((c) => c.sessionUrl), [loop("8")]);
  assert.equal(out.alreadyOnRuns, 0);
});

test("Speedhive race results are the track's clock: their UTC date is the day", () => {
  const race = (id: string) => `https://speedhive.mylaps.com/events/3706689/sessions/${id}`;
  const rows = [
    // A 2 PM heat in Tokyo, as the results list prints it.
    { sessionUrl: race("1"), sessionCompletedAtIso: "2026-09-13T14:00:00.000Z", linkedRunId: null },
    { sessionUrl: race("2"), sessionCompletedAtIso: "2026-09-12T23:30:00.000Z", linkedRunId: null },
  ];
  const out = splitDayCandidates(rows, "2026-09-13", "speedhive", "Asia/Tokyo");
  assert.deepEqual(out.toFile.map((c) => c.sessionUrl), [race("1")]);
});
