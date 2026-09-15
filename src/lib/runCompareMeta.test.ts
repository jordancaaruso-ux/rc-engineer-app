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

test("a run the app backfilled that evening shows the heat's time, not the save", () => {
  // "Add N other runs from today": row written 7:02 PM with the 10:40 AM heat's real instant on
  // both sessionCompletedAt and sortAt; loggingCompletedAt is the same evening save.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-09-12T09:02:00Z",
    loggingCompletedAt: "2026-09-12T09:02:00Z",
    sessionCompletedAt: "2026-09-12T00:40:00Z",
    sortAt: "2026-09-12T00:40:00Z",
  });
  assert.equal(iso(shown), "2026-09-12T00:40:00.000Z");
});

test("an unconfirmed run's session time is trusted even months after the day", () => {
  // Catching up on a 2025 day in September 2026: the fortnight rule would refuse the sheet's
  // time, but the app itself stamped this one from the timing sheet, so it stands.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-09-14T05:06:35Z",
    loggingCompletedAt: "2026-09-14T05:06:35Z",
    sessionCompletedAt: "2025-10-12T10:27:45Z",
    sortAt: "2025-10-12T10:27:45Z",
    unconfirmedAt: "2026-09-14T05:06:35Z",
  });
  assert.equal(iso(shown), "2025-10-12T10:27:45.000Z");
});

test("once confirmed, a run filed at its heat keeps the heat's time — sortAt agrees", () => {
  // The same row after the wizard save cleared `unconfirmedAt`: the fortnight floor would
  // print the save time, but sortAt still carries the app's own stamp of the heat.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-09-14T05:06:35Z",
    loggingCompletedAt: "2026-09-14T05:06:35Z",
    sessionCompletedAt: "2025-10-12T10:27:45Z",
    sortAt: "2025-10-12T10:27:45Z",
    unconfirmedAt: null,
  });
  assert.equal(iso(shown), "2025-10-12T10:27:45.000Z");
});

test("the run saved beside a backfill is stamped the same way and shows its heat", () => {
  // The catch-up parent: created and completed in September, sortAt stamped to the October
  // heat by the backfill exception in POST /api/runs.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-09-14T05:38:09Z",
    loggingCompletedAt: "2026-09-14T05:38:10Z",
    sessionCompletedAt: "2025-10-12T15:06:22Z",
    sortAt: "2025-10-12T15:06:22Z",
  });
  assert.equal(iso(shown), "2025-10-12T15:06:22.000Z");
});

test("a fortnight-old stamp with a DIFFERENT sortAt is still refused", () => {
  // A month-old session attached by hand to a fresh run: sortAt is the create time, so the
  // plausibility floor stands and the row shows when it was logged.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-08-27T04:40:47Z",
    loggingCompletedAt: "2026-08-27T04:41:00Z",
    sessionCompletedAt: "2026-08-08T07:36:59Z",
    sortAt: "2026-08-27T04:40:47Z",
  });
  assert.equal(iso(shown), "2026-08-27T04:41:00.000Z");
});

test("sortAt agreement never admits a stamp that lands AFTER the log", () => {
  // Legacy row: the migration copied an import-time stamp into sortAt; the upper bound
  // still refuses it because a real heat precedes the save that recorded it.
  const shown = resolveRunDisplayInstant({
    createdAt: "2026-06-28T02:09:00Z",
    loggingCompletedAt: "2026-06-28T02:30:00Z",
    sessionCompletedAt: "2026-06-29T08:19:38Z",
    sortAt: "2026-06-29T08:19:38Z",
  });
  assert.equal(iso(shown), "2026-06-28T02:30:00.000Z");
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
