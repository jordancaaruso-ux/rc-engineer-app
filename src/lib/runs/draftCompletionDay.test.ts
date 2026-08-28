import test from "node:test";
import assert from "node:assert/strict";
import { draftCompletionDayStamp } from "@/lib/runs/draftCompletionDay";

const TZ = "Australia/Sydney";

test("a run created and finished in one sitting is never touched", () => {
  const t = new Date("2026-08-25T02:00:00Z");
  const moved = draftCompletionDayStamp({
    sortAt: t,
    storedSessionCompletedAt: null,
    importedSessionCompletedAt: null,
    now: new Date("2026-08-25T02:12:00Z"),
    timeZone: TZ,
  });
  assert.equal(moved, null);
});

test("a draft banked last night moves onto the day it was driven", () => {
  // Saved 2026-08-24 20:14 Sydney (= 10:14Z), finished 2026-08-25 09:30 Sydney (= 23:30Z on 24th).
  const now = new Date("2026-08-24T23:30:00Z");
  const moved = draftCompletionDayStamp({
    sortAt: new Date("2026-08-24T10:14:00Z"),
    storedSessionCompletedAt: null,
    importedSessionCompletedAt: null,
    now,
    timeZone: TZ,
  });
  assert.notEqual(moved, null);
  assert.equal(moved!.sortAt.toISOString(), now.toISOString());
  assert.equal(
    moved!.sessionCompletedAt?.toISOString(),
    now.toISOString(),
    "the displayed time follows, or the row shows last night's clock"
  );
});

test("a timing import outranks the clock — that is when the car was actually out", () => {
  const onTrack = new Date("2026-08-24T23:05:00Z");
  const moved = draftCompletionDayStamp({
    sortAt: new Date("2026-08-24T10:14:00Z"),
    storedSessionCompletedAt: null,
    importedSessionCompletedAt: onTrack,
    now: new Date("2026-08-25T01:00:00Z"),
    timeZone: TZ,
  });
  assert.equal(moved!.sortAt.toISOString(), onTrack.toISOString());
});

test("an existing session time is never overwritten", () => {
  const stored = new Date("2026-08-24T23:05:00Z");
  const moved = draftCompletionDayStamp({
    sortAt: new Date("2026-08-20T10:00:00Z"),
    storedSessionCompletedAt: stored,
    importedSessionCompletedAt: null,
    now: new Date("2026-08-25T01:00:00Z"),
    timeZone: TZ,
  });
  assert.equal(moved!.sortAt.toISOString(), stored.toISOString());
  assert.equal(
    moved!.sessionCompletedAt?.toISOString(),
    stored.toISOString(),
    "handed back unchanged — the import knows better than the clock"
  );
});

test("the day is read in the driver's zone, not UTC", () => {
  /*
   * Both instants are the SAME UTC day (2026-08-24) and DIFFERENT Sydney days: 09:00 on the 24th
   * and 09:00 on the 25th. Reading the calendar in UTC would say "same day, nothing to do" and
   * leave a run driven on the 25th filed under the 24th — the exact class of bug this repo has
   * already paid for in event detection.
   */
  const moved = draftCompletionDayStamp({
    sortAt: new Date("2026-08-23T23:00:00Z"),
    storedSessionCompletedAt: null,
    importedSessionCompletedAt: null,
    now: new Date("2026-08-24T23:00:00Z"),
    timeZone: TZ,
  });
  assert.notEqual(moved, null, "UTC+10 rolls the day before UTC does");
});
