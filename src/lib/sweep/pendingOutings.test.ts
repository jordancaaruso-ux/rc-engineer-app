import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingOutingsFrom, splitChosen, type PendingOutingSource } from "@/lib/sweep/pendingOutings";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 19, 0, minutes));

function s(
  id: string,
  startMin: number,
  endMin: number,
  extra: Partial<PendingOutingSource> = {},
): PendingOutingSource {
  return {
    id,
    kind: "practice",
    start: at(startMin),
    end: at(endMin),
    driverCount: 1,
    lapCount: 10,
    ownLapCount: 10,
    ownBestLapSeconds: 15.1,
    ...extra,
  };
}

test("one row per time on track: the same heat from two sites is one pending run", () => {
  const rows = pendingOutingsFrom([
    s("liverc-heat", 60, 66, { kind: "official", driverCount: 10, ownLapCount: 22, ownBestLapSeconds: 14.9 }),
    s("speedhive-heat", 61, 66, { kind: "official", driverCount: 8, ownLapCount: 22, ownBestLapSeconds: 14.91 }),
    s("practice", 120, 126, { ownLapCount: 3, ownBestLapSeconds: 16.2 }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.id, "liverc-heat");
  assert.deepEqual(rows[0]!.sessionIds, ["liverc-heat", "speedhive-heat"]);
  assert.equal(rows[0]!.lapCount, 22);
  assert.equal(rows[0]!.bestLapSeconds, 14.9);
  assert.equal(rows[1]!.id, "practice");
  assert.equal(rows[1]!.lapCount, 3);
});

test("a two-lap shakedown is its own row, so it can be unticked", () => {
  const rows = pendingOutingsFrom([
    s("shakedown", 0, 1, { ownLapCount: 2, ownBestLapSeconds: 18.4 }),
    s("run", 10, 16, { ownLapCount: 20, ownBestLapSeconds: 15.0 }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.lapCount]),
    [
      ["shakedown", 2],
      ["run", 20],
    ],
  );
});

test("a primary with no own laps takes the fullest sheet's count", () => {
  const rows = pendingOutingsFrom([
    s("a", 0, 6, { kind: "official", driverCount: 10, ownLapCount: null, ownBestLapSeconds: null }),
    s("b", 0, 6, { ownLapCount: 18, ownBestLapSeconds: 15.3 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.lapCount, 18);
  assert.equal(rows[0]!.bestLapSeconds, 15.3);
});

test("splitChosen: ticked wins over unticked, unknown ids are ignored", () => {
  const pending = pendingOutingsFrom([s("a", 0, 6), s("b", 20, 26), s("c", 40, 46)]);
  const { keep, decline } = splitChosen(pending, ["a", "b", "zzz"], ["b", "c"]);
  assert.deepEqual(
    keep.map((o) => o.id),
    ["a", "b"],
  );
  assert.deepEqual(
    decline.map((o) => o.id),
    ["c"],
  );
});
