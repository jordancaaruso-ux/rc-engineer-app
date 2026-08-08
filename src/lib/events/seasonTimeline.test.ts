/**
 * Run: `npx tsx src/lib/events/seasonTimeline.test.ts`
 *
 * The timeline is the page's hero and a marker in the wrong place is a lie about when the
 * driver raced — with no way to notice it by eye, because every mark looks plausible.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTimelineDomain,
  daysInYear,
  positionPct,
  tickColumns,
  widthPct,
} from "@/lib/events/seasonTimeline";

const YEAR = { year: 2026, years: [2026], todayYmd: "2026-08-08" };

test("a year domain spans Jan 1 to Dec 31 with twelve month ticks", () => {
  const d = buildTimelineDomain(YEAR);
  assert.equal(d.startYmd, "2026-01-01");
  assert.equal(d.endYmd, "2026-12-31");
  assert.equal(d.totalDays, 365);
  assert.equal(d.ticks.length, 12);
  assert.deepEqual(
    d.ticks.map((t) => t.days),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  );
  assert.equal(tickColumns(d), "31fr 28fr 31fr 30fr 31fr 30fr 31fr 31fr 30fr 31fr 30fr 31fr");
});

test("leap years widen February and the domain", () => {
  const d = buildTimelineDomain({ year: 2028, years: [2028], todayYmd: "2026-08-08" });
  assert.equal(daysInYear(2028), 366);
  assert.equal(d.totalDays, 366);
  assert.equal(d.ticks[1]!.days, 29);
});

test("the handoff's formula: ((dayOfYear - 1) / daysInYear) * 100", () => {
  const d = buildTimelineDomain(YEAR);
  assert.equal(positionPct(d, "2026-01-01"), 0);
  // 29 July 2026 is day 210 of the year.
  assert.equal(positionPct(d, "2026-07-29"), ((210 - 1) / 365) * 100);
  assert.ok(Math.abs(positionPct(d, "2026-12-31")! - ((365 - 1) / 365) * 100) < 1e-9);
});

test("dates outside the domain return null rather than clamping to an edge", () => {
  const d = buildTimelineDomain(YEAR);
  assert.equal(positionPct(d, "2025-12-31"), null);
  assert.equal(positionPct(d, "2027-01-01"), null);
});

test("today sits where the dashed line should be, and vanishes off-domain", () => {
  const d = buildTimelineDomain(YEAR);
  // 8 Aug 2026 is day 220.
  assert.equal(d.todayPct, ((220 - 1) / 365) * 100);
  const past = buildTimelineDomain({ year: 2024, years: [2024], todayYmd: "2026-08-08" });
  assert.equal(past.todayPct, null);
});

test("a multi-day meeting is as wide as it is long", () => {
  const d = buildTimelineDomain(YEAR);
  assert.equal(widthPct(d, 3), (3 / 365) * 100);
  assert.ok(widthPct(d, 5) > widthPct(d, 3), "five days must draw wider than three");
  assert.equal(widthPct(d, 0), widthPct(d, 1), "a zero-length meeting still occupies a day");
});

test("all time spans every year with events, ticking by year", () => {
  const d = buildTimelineDomain({ year: null, years: [2026, 2024], todayYmd: "2026-08-08" });
  assert.equal(d.startYmd, "2024-01-01");
  assert.equal(d.endYmd, "2026-12-31");
  assert.equal(d.totalDays, 366 + 365 + 365);
  assert.deepEqual(
    d.ticks.map((t) => t.label),
    ["2024", "2025", "2026"]
  );
  // A 2024 date must land in the first third, not at the far left of a single-year view.
  const pct = positionPct(d, "2024-07-01")!;
  assert.ok(pct > 10 && pct < 20, `expected the 2024 mid-year mark near 16%, got ${pct}`);
});

test("all time still has somewhere to put today when the last event is years old", () => {
  const d = buildTimelineDomain({ year: null, years: [2024], todayYmd: "2026-08-08" });
  assert.equal(d.endYmd, "2026-12-31");
  assert.ok(d.todayPct != null && d.todayPct > 0);
});

test("the current tick is flagged only in the year that contains today", () => {
  const now = buildTimelineDomain(YEAR);
  assert.deepEqual(
    now.ticks.map((t) => t.current),
    [false, false, false, false, false, false, false, true, false, false, false, false]
  );
  const other = buildTimelineDomain({ year: 2025, years: [2025], todayYmd: "2026-08-08" });
  assert.ok(other.ticks.every((t) => !t.current));
});
