import test from "node:test";
import assert from "node:assert/strict";
import {
  eveningWindowOpen,
  morningWindowOpen,
  previousLocalYmd,
  racedIntoTheEvening,
  trackLocalYmd,
} from "./sweepDocs";

const SYD = "Australia/Sydney";

test("the evening window is 20:00–20:29 track time", () => {
  // 20:05 Sydney (AEST) = 10:05Z
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T10:05:00Z")), true);
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T10:29:00Z")), true);
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T10:30:00Z")), false);
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T09:59:00Z")), false);
  // Same instant is 12:05 in Paris — not evening there.
  assert.equal(eveningWindowOpen("Europe/Paris", new Date("2026-09-19T10:05:00Z")), false);
  assert.equal(eveningWindowOpen("Europe/Paris", new Date("2026-09-19T18:03:00Z")), true);
});

test("the morning window is 08:00–08:29 track time", () => {
  // 08:10 Sydney (AEST) = 22:10Z the day before
  assert.equal(morningWindowOpen(SYD, new Date("2026-09-19T22:10:00Z")), true);
  assert.equal(morningWindowOpen(SYD, new Date("2026-09-19T22:35:00Z")), false);
  assert.equal(morningWindowOpen(SYD, new Date("2026-09-19T10:05:00Z")), false);
});

test("track-local day, and the day before it", () => {
  // 23:30 Sydney on the 19th is 13:30Z on the 19th; 00:30 Sydney on the 20th is 14:30Z on the 19th.
  assert.equal(trackLocalYmd(SYD, new Date("2026-09-19T13:30:00Z")), "2026-09-19");
  assert.equal(trackLocalYmd(SYD, new Date("2026-09-19T14:30:00Z")), "2026-09-20");
  // 8 am Sydney on the 20th owes the 19th.
  assert.equal(previousLocalYmd(SYD, new Date("2026-09-19T22:10:00Z")), "2026-09-19");
  assert.equal(previousLocalYmd(SYD, new Date("2026-09-30T22:10:00Z")), "2026-09-30");
  assert.equal(previousLocalYmd(SYD, new Date("2026-10-01T22:10:00Z")), "2026-10-01");
});

/*
 * Founder ruling 2026-09-16: 8 pm is the summary only if the driver has been off the track since
 * 7:30. A session at or after 7:30 pm means they are still racing — the summary waits for 8 am.
 */
test("a session at or after 19:30 track time means the driver is still racing", () => {
  const ymd = "2026-09-19";
  // 19:29 Sydney = 09:29Z: quiet in time.
  assert.equal(racedIntoTheEvening(new Date("2026-09-19T09:29:00Z"), SYD, ymd), false);
  // 19:30 exactly: still racing.
  assert.equal(racedIntoTheEvening(new Date("2026-09-19T09:30:00Z"), SYD, ymd), true);
  // 19:45: still racing.
  assert.equal(racedIntoTheEvening(new Date("2026-09-19T09:45:00Z"), SYD, ymd), true);
  // Nothing found: not racing.
  assert.equal(racedIntoTheEvening(null, SYD, ymd), false);
  // A late session on ANOTHER day does not hold this one.
  assert.equal(racedIntoTheEvening(new Date("2026-09-18T09:45:00Z"), SYD, ymd), false);
  // 19:45 in Paris is 17:45Z — the same clock reading, read in the track's zone.
  assert.equal(racedIntoTheEvening(new Date("2026-09-19T17:45:00Z"), "Europe/Paris", ymd), true);
  assert.equal(racedIntoTheEvening(new Date("2026-09-19T17:45:00Z"), SYD, ymd), false);
});
