/**
 * Run: `npx tsx src/lib/eventActive.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventCalendarStatus,
  eventIsActiveOnCalendarDay,
  eventIsOnTodayAtTrack,
  pickFeaturedEvent,
  startOfDayInTimeZone,
  todayBoundsInTimeZone,
  wallClockAsUtcToInstant,
} from "@/lib/eventActive";

const may26NoonUtc = new Date(Date.UTC(2026, 4, 26, 12, 0, 0, 0));
const may27NoonUtc = new Date(Date.UTC(2026, 4, 27, 12, 0, 0, 0));
const may28NoonUtc = new Date(Date.UTC(2026, 4, 28, 12, 0, 0, 0));

function clubDay(overrides: Partial<{ id: string; runCount: number }> = {}) {
  return {
    id: overrides.id ?? "ev-club",
    name: "Club day",
    startDate: may26NoonUtc,
    endDate: may26NoonUtc,
    runCount: overrides.runCount ?? 1,
  };
}

test("single-day club day is active only on that calendar day", () => {
  const ev = clubDay();
  assert.equal(eventCalendarStatus(ev, "Australia/Sydney", "2026-05-26"), "active");
  assert.equal(eventCalendarStatus(ev, "Australia/Sydney", "2026-05-27"), "past");
  assert.equal(eventCalendarStatus(ev, "Australia/Sydney", "2026-05-25"), "upcoming");
  assert.equal(eventIsActiveOnCalendarDay(ev, "Australia/Sydney", "2026-05-26"), true);
  assert.equal(eventIsActiveOnCalendarDay(ev, "Australia/Sydney", "2026-05-27"), false);
});

test("pickFeaturedEvent prefers active, then next, then last with runs", () => {
  const nowOnClubDay = new Date(Date.UTC(2026, 4, 26, 2, 0, 0, 0));
  const events = [
    clubDay({ id: "club", runCount: 2 }),
    {
      id: "future",
      name: "Nationals",
      startDate: may28NoonUtc,
      endDate: may28NoonUtc,
      runCount: 0,
    },
  ];

  const activePick = pickFeaturedEvent(events, "Australia/Sydney", nowOnClubDay);
  assert.equal(activePick?.id, "club");
  assert.equal(activePick?.featuredStatus, "active");

  const nextPick = pickFeaturedEvent(events, "Australia/Sydney", may27NoonUtc);
  assert.equal(nextPick?.id, "future");
  assert.equal(nextPick?.featuredStatus, "next");

  const lastPick = pickFeaturedEvent(
    [{ ...clubDay({ id: "past-only", runCount: 3 }) }],
    "Australia/Sydney",
    may27NoonUtc
  );
  assert.equal(lastPick?.id, "past-only");
  assert.equal(lastPick?.featuredStatus, "last");
});

test("pickFeaturedEvent returns null when no upcoming and no past runs", () => {
  const pick = pickFeaturedEvent(
    [{ ...clubDay({ runCount: 0 }) }],
    "Australia/Sydney",
    may27NoonUtc
  );
  assert.equal(pick, null);
});

test("startOfDayInTimeZone: Sydney winter (AEST, UTC+10) anchors to the user's midnight", () => {
  // 9:00am 19 July in Sydney = 23:00Z 18 July. Local midnight = 14:00Z the day before.
  const now = new Date("2026-07-18T23:00:00Z");
  const start = startOfDayInTimeZone("Australia/Sydney", now);
  assert.equal(start.toISOString(), "2026-07-18T14:00:00.000Z");
});

test("startOfDayInTimeZone: UTC zone matches plain UTC midnight", () => {
  const now = new Date("2026-07-19T01:21:50Z");
  const start = startOfDayInTimeZone("UTC", now);
  assert.equal(start.toISOString(), "2026-07-19T00:00:00.000Z");
});

test("startOfDayInTimeZone: negative-offset zone (America/New_York)", () => {
  // 8pm 18 July in New York (EDT, UTC-4) = 00:00Z 19 July. Local midnight = 04:00Z.
  const now = new Date("2026-07-19T00:00:00Z");
  const start = startOfDayInTimeZone("America/New_York", now);
  assert.equal(start.toISOString(), "2026-07-18T04:00:00.000Z");
});

test("todayBoundsInTimeZone: the 10am-AEST regression — a morning draft stays inside today", () => {
  // Draft saved 8:31am AEST 19 July (22:31Z on the 18th); checked at 11:21am AEST.
  // Server-local (UTC) bounds dropped it at 10am; user-zone bounds must not.
  const draftCreatedAt = new Date("2026-07-18T22:31:28Z");
  const now = new Date("2026-07-19T01:21:50Z");
  const { start, end } = todayBoundsInTimeZone("Australia/Sydney", now);
  assert.ok(draftCreatedAt >= start && draftCreatedAt < end);
  // And yesterday evening's run (9pm AEST 18 July) is NOT today.
  assert.ok(new Date("2026-07-18T11:00:00Z") < start);
});

test("todayBoundsInTimeZone: end is the next local midnight (24h on a normal day)", () => {
  const { start, end } = todayBoundsInTimeZone(
    "Australia/Sydney",
    new Date("2026-07-19T01:00:00Z")
  );
  assert.equal(end.getTime() - start.getTime(), 24 * 3_600_000);
});

test("todayBoundsInTimeZone: DST spring-forward day is 23 hours (Sydney, 4 Oct 2026)", () => {
  // Sydney DST starts 2am 4 Oct 2026 (AEST +10 → AEDT +11).
  const { start, end } = todayBoundsInTimeZone(
    "Australia/Sydney",
    new Date("2026-10-04T05:00:00Z")
  );
  assert.equal(start.toISOString(), "2026-10-03T14:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-04T13:00:00.000Z");
  assert.equal(end.getTime() - start.getTime(), 23 * 3_600_000);
});

test("todayBoundsInTimeZone: DST fall-back day is 25 hours (Sydney, 5 Apr 2026)", () => {
  const { start, end } = todayBoundsInTimeZone(
    "Australia/Sydney",
    new Date("2026-04-05T00:00:00Z")
  );
  assert.equal(start.toISOString(), "2026-04-04T13:00:00.000Z");
  assert.equal(end.toISOString(), "2026-04-05T14:00:00.000Z");
  assert.equal(end.getTime() - start.getTime(), 25 * 3_600_000);
});

test("wallClockAsUtcToInstant: Sydney winter (AEST +10)", () => {
  // LiveRC wall clock 4:36 PM stored as-if-UTC → real instant is 06:36 UTC.
  const real = wallClockAsUtcToInstant(new Date("2026-07-19T16:36:19.000Z"), "Australia/Sydney");
  assert.equal(real.toISOString(), "2026-07-19T06:36:19.000Z");
});

test("wallClockAsUtcToInstant: Sydney summer (AEDT +11)", () => {
  const real = wallClockAsUtcToInstant(new Date("2026-01-10T16:00:00.000Z"), "Australia/Sydney");
  assert.equal(real.toISOString(), "2026-01-10T05:00:00.000Z");
});

test("wallClockAsUtcToInstant: negative offset (Los Angeles, PDT -7)", () => {
  const real = wallClockAsUtcToInstant(new Date("2026-07-19T16:36:00.000Z"), "America/Los_Angeles");
  assert.equal(real.toISOString(), "2026-07-19T23:36:00.000Z");
});

test("eventIsOnTodayAtTrack: a Sydney race morning counts before 10 am, when the server's UTC day hasn't turned", () => {
  const sep26 = { startDate: new Date(Date.UTC(2026, 8, 26, 12)), endDate: new Date(Date.UTC(2026, 8, 26, 12)) };
  const eightAmSydney = new Date("2026-09-25T22:00:00.000Z"); // 08:00 AEST on the 26th
  assert.equal(eventIsOnTodayAtTrack(sep26, "Australia/Sydney", eightAmSydney), true);
  assert.equal(eventIsActiveOnCalendarDay(sep26, "UTC", "2026-09-25"), false); // what the UTC server saw
  const elevenPmBefore = new Date("2026-09-25T13:00:00.000Z"); // 23:00 AEST on the 25th
  assert.equal(eventIsOnTodayAtTrack(sep26, "Australia/Sydney", elevenPmBefore), false);
});

test("eventIsOnTodayAtTrack: an American evening meeting still counts after 5 pm Pacific", () => {
  const sep30 = { startDate: new Date(Date.UTC(2026, 8, 30, 12)), endDate: new Date(Date.UTC(2026, 8, 30, 12)) };
  const sevenPmPacific = new Date("2026-10-01T02:00:00.000Z"); // 19:00 PDT on the 30th
  assert.equal(eventIsOnTodayAtTrack(sep30, "America/Los_Angeles", sevenPmPacific), true);
  const nextEvening = new Date("2026-10-02T02:00:00.000Z"); // 19:00 PDT on 1 Oct
  assert.equal(eventIsOnTodayAtTrack(sep30, "America/Los_Angeles", nextEvening), false);
});

test("eventIsOnTodayAtTrack: older rows at local midnight or UTC midnight still land on their day", () => {
  const sydneyMidnight = new Date("2026-09-25T14:00:00.000Z"); // 00:00 AEST on the 26th
  const ev1 = { startDate: sydneyMidnight, endDate: sydneyMidnight };
  assert.equal(eventIsOnTodayAtTrack(ev1, "Australia/Sydney", new Date("2026-09-26T02:00:00.000Z")), true);
  const utcMidnight = new Date("2026-09-30T00:00:00.000Z");
  const ev2 = { startDate: utcMidnight, endDate: utcMidnight };
  assert.equal(eventIsOnTodayAtTrack(ev2, "America/New_York", new Date("2026-09-30T23:00:00.000Z")), true); // 19:00 EDT
});

test("eventIsOnTodayAtTrack: a three-day meeting counts on its middle day", () => {
  const titles = { startDate: new Date(Date.UTC(2026, 9, 2, 12)), endDate: new Date(Date.UTC(2026, 9, 4, 12)) };
  assert.equal(eventIsOnTodayAtTrack(titles, "Australia/Brisbane", new Date("2026-10-02T23:30:00.000Z")), true); // 09:30 on 3 Oct
});
