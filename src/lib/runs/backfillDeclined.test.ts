import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKFILL_DECLINED_STORAGE_KEY,
  declineSessions,
  readDeclined,
  undeclinedSessions,
} from "@/lib/runs/backfillDeclined";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-14T04:00:00.000Z").getTime();

test("a session declined once is not offered by the prompt again", () => {
  const storage = memoryStorage();
  const sessions = [{ sessionUrl: "https://t/s/2" }, { sessionUrl: "https://t/s/3" }];
  assert.equal(undeclinedSessions(sessions, readDeclined(storage, NOW)).length, 2);

  declineSessions(["https://t/s/2", "https://t/s/3"], storage, NOW);
  assert.deepEqual(undeclinedSessions(sessions, readDeclined(storage, NOW)), []);

  // A session that turns up later is still fresh, so the prompt opens for it.
  const later = [...sessions, { sessionUrl: "https://t/s/4" }];
  assert.deepEqual(undeclinedSessions(later, readDeclined(storage, NOW + DAY)), [{ sessionUrl: "https://t/s/4" }]);
});

test("a no expires after 30 days and garbage in the store is ignored", () => {
  const storage = memoryStorage({
    [BACKFILL_DECLINED_STORAGE_KEY]: JSON.stringify({
      "https://t/s/old": new Date(NOW - 31 * DAY).toISOString(),
      "https://t/s/recent": new Date(NOW - 2 * DAY).toISOString(),
      "https://t/s/junk": 42,
    }),
  });
  assert.deepEqual(Object.keys(readDeclined(storage, NOW)), ["https://t/s/recent"]);

  const broken = memoryStorage({ [BACKFILL_DECLINED_STORAGE_KEY]: "{not json" });
  assert.deepEqual(readDeclined(broken, NOW), {});
  // Writing through a broken store rewrites it clean.
  declineSessions(["https://t/s/9"], broken, NOW);
  assert.deepEqual(Object.keys(readDeclined(broken, NOW)), ["https://t/s/9"]);
});

test("no storage at all (server render, private mode) means nothing is ever declined", () => {
  assert.deepEqual(readDeclined(null, NOW), {});
  assert.deepEqual(declineSessions(["https://t/s/1"], null, NOW), { "https://t/s/1": new Date(NOW).toISOString() });
});
