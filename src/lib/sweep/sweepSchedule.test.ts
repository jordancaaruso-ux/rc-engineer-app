import test from "node:test";
import assert from "node:assert/strict";
import {
  armedUntilForDay,
  backoffAfterFailure,
  eveningWindowOpen,
  isArmedDocExpired,
  isSourceDue,
  newArmedTrackDoc,
  rememberSeen,
  SEEN_CAP,
  trackLocalYmd,
} from "./sweepDocs";

const SYD = "Australia/Sydney";
const T1 = { id: "t1", name: "Track 1", speedhiveUrl: "https://speedhive.mylaps.com/practice/1", liveRcUrl: null, timeZone: SYD };

test("a fresh armed doc is due for both sources at once", () => {
  const now = new Date("2026-09-19T02:00:00Z"); // 12:00 Sydney
  const doc = newArmedTrackDoc(T1, now);
  assert.equal(isSourceDue(doc, "speedhive", now), true);
  assert.equal(isSourceDue(doc, "liverc", now), true);
});

test("speedhive is due every five minutes, LiveRC every ten, with a little slack", () => {
  const now = new Date("2026-09-19T02:00:00Z");
  const doc = newArmedTrackDoc(T1, now);
  doc.lastPolledIso = { speedhive: now.toISOString(), liverc: now.toISOString() };
  const plus4m40 = new Date(now.getTime() + (4 * 60 + 40) * 1000);
  const plus3 = new Date(now.getTime() + 3 * 60 * 1000);
  const plus9m40 = new Date(now.getTime() + (9 * 60 + 40) * 1000);
  assert.equal(isSourceDue(doc, "speedhive", plus3), false);
  assert.equal(isSourceDue(doc, "speedhive", plus4m40), true);
  assert.equal(isSourceDue(doc, "liverc", plus4m40), false);
  assert.equal(isSourceDue(doc, "liverc", plus9m40), true);
});

test("the doc dies at track-local midnight, not the server's", () => {
  const noonSydney = new Date("2026-09-19T02:00:00Z");
  const doc = newArmedTrackDoc(T1, noonSydney);
  // 2026-09-19 23:59 Sydney = 13:59Z; 2026-09-20 00:01 Sydney = 14:01Z (AEST, UTC+10).
  assert.equal(isArmedDocExpired(doc, new Date("2026-09-19T13:59:00Z")), false);
  assert.equal(isArmedDocExpired(doc, new Date("2026-09-19T14:01:00Z")), true);
  assert.equal(isSourceDue(doc, "speedhive", new Date("2026-09-19T14:01:00Z")), false);
  assert.equal(armedUntilForDay(SYD, noonSydney).toISOString(), "2026-09-19T14:00:00.000Z");
});

test("back-off doubles from five minutes and caps at an hour", () => {
  const now = new Date("2026-09-19T02:00:00Z");
  let b = backoffAfterFailure({ fails: 0 }, now);
  assert.equal(b.fails, 1);
  assert.equal(new Date(b.nextTryIso!).getTime() - now.getTime(), 5 * 60 * 1000);
  b = backoffAfterFailure(b, now);
  assert.equal(new Date(b.nextTryIso!).getTime() - now.getTime(), 10 * 60 * 1000);
  b = backoffAfterFailure(b, now);
  b = backoffAfterFailure(b, now);
  assert.equal(new Date(b.nextTryIso!).getTime() - now.getTime(), 40 * 60 * 1000);
  b = backoffAfterFailure(b, now);
  b = backoffAfterFailure(b, now);
  assert.equal(new Date(b.nextTryIso!).getTime() - now.getTime(), 60 * 60 * 1000);

  const doc = newArmedTrackDoc(T1, now);
  doc.backoff = backoffAfterFailure({ fails: 0 }, now);
  assert.equal(isSourceDue(doc, "speedhive", new Date(now.getTime() + 60 * 1000)), false);
  assert.equal(isSourceDue(doc, "speedhive", new Date(now.getTime() + 6 * 60 * 1000)), true);
});

test("the evening window is 20:00–20:09 track time", () => {
  // 20:05 Sydney (AEST) = 10:05Z
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T10:05:00Z")), true);
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T10:12:00Z")), false);
  assert.equal(eveningWindowOpen(SYD, new Date("2026-09-19T09:59:00Z")), false);
  // Same instant is 12:05 in Paris — not evening there.
  assert.equal(eveningWindowOpen("Europe/Paris", new Date("2026-09-19T10:05:00Z")), false);
  assert.equal(eveningWindowOpen("Europe/Paris", new Date("2026-09-19T18:03:00Z")), true);
});

test("track-local day", () => {
  // 23:30 Sydney on the 19th is 13:30Z on the 19th; 00:30 Sydney on the 20th is 14:30Z on the 19th.
  assert.equal(trackLocalYmd(SYD, new Date("2026-09-19T13:30:00Z")), "2026-09-19");
  assert.equal(trackLocalYmd(SYD, new Date("2026-09-19T14:30:00Z")), "2026-09-20");
});

test("seen keys are deduplicated and capped from the front", () => {
  let seen: string[] = [];
  seen = rememberSeen(seen, "a");
  seen = rememberSeen(seen, "a");
  assert.deepEqual(seen, ["a"]);
  for (let i = 0; i < SEEN_CAP + 5; i++) seen = rememberSeen(seen, `k${i}`);
  assert.equal(seen.length, SEEN_CAP);
  assert.equal(seen.includes("a"), false);
  assert.equal(seen[seen.length - 1], `k${SEEN_CAP + 4}`);
});
