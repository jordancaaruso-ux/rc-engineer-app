/**
 * Run timestamps read the same for every racer: the month spelled, never a day-first number
 * (test drive 2026-09-26: US and Canadian racers read "05/10/2026" as May 10).
 *
 *   npx tsx --test src/lib/formatDate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatRunCreatedAtDateTime, formatRunDateTime, isDateOnlyRunTime } from "@/lib/formatDate";

test("a saved setup's time reads the same in Chicago as in Sydney", () => {
  const savedAt = "2026-09-26T07:57:00.000Z";
  assert.equal(formatRunCreatedAtDateTime(savedAt, "America/Chicago"), "26 Sept 2026, 2:57 AM");
  assert.equal(formatRunCreatedAtDateTime(savedAt, "Australia/Sydney"), "26 Sept 2026, 5:57 PM");
  assert.equal(formatRunCreatedAtDateTime(savedAt, "America/Toronto"), "26 Sept 2026, 3:57 AM");
});

test("an early-month date can't be read the wrong way round", () => {
  const label = formatRunCreatedAtDateTime("2026-10-05T01:04:00.000Z", "UTC");
  assert.equal(label, "5 Oct 2026, 1:04 AM");
  assert.doesNotMatch(label, /\d+\/\d+\/\d+/);
});

test("midnight and noon", () => {
  assert.equal(formatRunCreatedAtDateTime("2026-07-19T00:00:00.000Z", "UTC"), "19 Jul 2026, 12:00 AM");
  assert.equal(formatRunCreatedAtDateTime("2026-07-19T12:00:00.000Z", "UTC"), "19 Jul 2026, 12:00 PM");
  assert.equal(formatRunCreatedAtDateTime("2026-07-19T23:59:00.000Z", "UTC"), "19 Jul 2026, 11:59 PM");
});

test("every month is spelled", () => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  months.forEach((name, i) => {
    const d = new Date(Date.UTC(2026, i, 15, 9, 30));
    assert.equal(formatRunCreatedAtDateTime(d, "UTC"), `15 ${name} 2026, 9:30 AM`);
  });
});

test("not a date is a dash", () => {
  assert.equal(formatRunCreatedAtDateTime("not a date", "UTC"), "—");
});

// Test drive 2026-09-26: a LiveRC race whose clock couldn't be found is stored as midnight on its
// day, and Sessions, the run and the day chart printed "24 Sept, 12:00 AM".

test("a run time that is only a day prints the day, never 12:00 AM", () => {
  const now = new Date("2026-09-26T08:00:00Z");
  const midnightMelbourne = "2026-09-23T14:00:00.000Z"; // 24 Sep, 00:00 in Melbourne
  assert.equal(isDateOnlyRunTime(midnightMelbourne, "Australia/Melbourne"), true);
  assert.match(formatRunDateTime(midnightMelbourne, "Australia/Melbourne", now), /^24 Sept?$/);
  assert.match(
    formatRunDateTime("2025-09-23T14:00:00.000Z", "Australia/Melbourne", now),
    /^24 Sept? 2025$/,
    "an earlier year keeps its year"
  );
});

test("any real clock time still prints, midnight read in another zone included", () => {
  const now = new Date("2026-09-26T08:00:00Z");
  assert.equal(isDateOnlyRunTime("2026-09-23T14:01:00.000Z", "Australia/Melbourne"), false);
  assert.equal(isDateOnlyRunTime("2026-09-23T14:00:00.001Z", "Australia/Melbourne"), false);
  assert.equal(isDateOnlyRunTime("2026-09-23T14:00:00.000Z", "Australia/Perth"), false);
  assert.equal(isDateOnlyRunTime("not a date", "UTC"), false);
  assert.match(formatRunDateTime("2026-09-23T14:01:00.000Z", "Australia/Melbourne", now), /^24 Sept?, 12:01 AM$/);
  assert.match(formatRunDateTime("2026-09-24T04:41:00.000Z", "Australia/Melbourne", now), /^24 Sept?, 2:41 PM$/);
});
