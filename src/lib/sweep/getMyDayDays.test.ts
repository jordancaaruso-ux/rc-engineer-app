import test from "node:test";
import assert from "node:assert/strict";
import {
  dayBoundsForYmd,
  daysFromToday,
  isValidYmd,
  recentDayChoices,
  splitDayCandidates,
} from "@/lib/sweep/getMyDayDays";

const SYD = "Australia/Sydney";

test("the sheet offers today, yesterday and three named days, in the zone's calendar", () => {
  const noonTuesdaySydney = new Date("2026-09-15T02:00:00Z");
  assert.deepEqual(recentDayChoices(noonTuesdaySydney, SYD), [
    { ymd: "2026-09-15", label: "Today" },
    { ymd: "2026-09-14", label: "Yesterday" },
    { ymd: "2026-09-13", label: "Sun" },
    { ymd: "2026-09-12", label: "Sat" },
    { ymd: "2026-09-11", label: "Fri" },
  ]);
});

test("the days roll back across a month end", () => {
  const out = recentDayChoices(new Date("2026-10-02T02:00:00Z"), SYD).map((d) => d.ymd);
  assert.deepEqual(out, ["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29", "2026-09-28"]);
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

test("Speedhive sessions are placed on the day in the track's zone, not by their UTC date", () => {
  const rows = [
    // 08:30 on the 13th in Sydney.
    { sessionUrl: "https://speedhive/x", sessionCompletedAtIso: "2026-09-12T22:30:00.000Z", linkedRunId: null },
    // 00:30 on the 14th in Sydney, whatever its UTC date says.
    { sessionUrl: "https://speedhive/y", sessionCompletedAtIso: "2026-09-13T14:30:00.000Z", linkedRunId: null },
  ];
  const out = splitDayCandidates(rows, "2026-09-13", "speedhive", SYD);
  assert.deepEqual(out.toFile.map((c) => c.sessionUrl), ["https://speedhive/x"]);
  assert.equal(out.alreadyOnRuns, 0);
});
