/**
 * The one clock a run's time is printed from, checked against real rows from Jordan's
 * Bayside weekend (25–29 Jun 2026, Australia/Adelaide) — the shapes that broke it.
 *
 *   npx tsx --test src/lib/runCompareMeta.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRunDisplayInstant } from "./runCompareMeta";

const iso = (d: Date) => d.toISOString();

test("a timing-sheet time minutes before the save is the on-track time", () => {
  // Qualifying: log started 11:46, heat result imported 12:21, sheet says 12:18.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-27T02:16:00Z",
    loggingCompletedAt: "2026-06-27T02:51:00Z",
    sessionCompletedAt: "2026-06-27T02:48:26Z",
  });
  assert.equal(iso(shown), "2026-06-27T02:48:26.000Z");
});

test("a wall clock stored as if UTC (hours after the save) is refused; the save wins", () => {
  // Practice: log started 8:40, finished 11:37; the sheet's 9:25 was stored as 09:25Z (= 6:55 PM).
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-27T23:10:00Z",
    loggingCompletedAt: "2026-06-28T02:07:00Z",
    sessionCompletedAt: "2026-06-28T09:25:51Z",
  });
  assert.equal(iso(shown), "2026-06-28T02:07:00.000Z");
});

test("a Sunday main whose results were imported Monday shows Sunday", () => {
  // createdAt Sun 11:39; saved complete + 'session time' both Monday 5:50 PM (the import).
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-28T02:09:00Z",
    loggingCompletedAt: "2026-06-29T08:20:00Z",
    sessionCompletedAt: "2026-06-29T08:19:38Z",
  });
  assert.equal(iso(shown), "2026-06-28T02:09:00.000Z");
});

test("a draft banked the night before shows the morning it was driven", () => {
  // created Thu 9:42 PM, finished Fri 8:41 AM with the sheet's 8:40 AM.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-25T12:12:00Z",
    loggingCompletedAt: "2026-06-25T23:11:00Z",
    sessionCompletedAt: "2026-06-25T23:10:18Z",
  });
  assert.equal(iso(shown), "2026-06-25T23:10:18.000Z");
});

test("an auto-created practice run synced days later keeps its on-track time", () => {
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-08-12T04:00:00Z",
    loggingCompletedAt: "2026-08-12T04:00:00Z",
    sessionCompletedAt: "2026-08-09T00:30:00Z",
  });
  assert.equal(iso(shown), "2026-08-09T00:30:00.000Z");
});

test("with no sheet time, a same-outing save beats the log's start", () => {
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-26T01:13:00Z",
    loggingCompletedAt: "2026-06-26T01:32:00Z",
    sessionCompletedAt: null,
  });
  assert.equal(iso(shown), "2026-06-26T01:32:00.000Z");
});

test("legacy rows with nothing else fall back to creation", () => {
  const shown = resolveRunDisplayInstant({ createdAt: "2026-05-23T01:00:00Z" });
  assert.equal(iso(shown), "2026-05-23T01:00:00.000Z");
});

test("the draggable ordering stamp is never shown", () => {
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-05-23T01:00:00Z",
    sortAt: "2026-05-23T03:00:00Z",
  });
  assert.equal(iso(shown), "2026-05-23T01:00:00.000Z");
});
