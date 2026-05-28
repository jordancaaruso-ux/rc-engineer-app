/**
 * Run: `npx tsx src/lib/eventActive.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventCalendarStatus,
  eventIsActiveOnCalendarDay,
  pickFeaturedEvent,
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
