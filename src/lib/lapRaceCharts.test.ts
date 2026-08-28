import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaceRanges, buildRaceProgress, MIN_CLEAN_LAPS_FOR_PACE_RANGE } from "./lapRaceCharts";
import type { LapRow } from "./lapAnalysis";

function laps(times: number[], opts?: { lap0?: number; excluded?: number[] }): LapRow[] {
  const rows: LapRow[] = times.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: !(opts?.excluded ?? []).includes(i + 1),
  }));
  if (opts?.lap0 != null) rows.unshift({ lapNumber: 0, lapTimeSeconds: opts.lap0, isIncluded: false });
  return rows;
}

test("gap to leader is elapsed time behind whoever leads at that lap", () => {
  const p = buildRaceProgress([
    { id: "a", laps: laps([10, 10, 10]) },
    { id: "b", laps: laps([11, 9, 12]) },
  ]);
  const a = p.drivers.find((d) => d.id === "a")!;
  const b = p.drivers.find((d) => d.id === "b")!;
  assert.deepEqual(a.elapsed, [10, 20, 30]);
  assert.deepEqual(b.elapsed, [11, 20, 32]);
  assert.deepEqual(a.gaps, [0, 0, 0]);
  assert.deepEqual(b.gaps.map((g) => Number(g.toFixed(3))), [1, 0, 2]);
  assert.deepEqual(a.positions, [1, 1, 1]);
  // Level on elapsed time after lap 2: input order (classification) breaks the tie.
  assert.deepEqual(b.positions, [2, 2, 2]);
});

test("a crash lap counts as time even though the grid excludes it from pace", () => {
  const p = buildRaceProgress([
    { id: "a", laps: laps([10, 10, 10]) },
    { id: "b", laps: laps([10, 30, 10], { excluded: [2] }) },
  ]);
  const b = p.drivers.find((d) => d.id === "b")!;
  assert.deepEqual(b.gaps, [0, 20, 20]);
});

test("a driver who stops has no position after their last lap, and the rest move up", () => {
  const p = buildRaceProgress([
    { id: "leader-dnf", laps: laps([9, 9, 9]) },
    { id: "a", laps: laps([10, 10, 10, 10, 10]) },
    { id: "b", laps: laps([11, 11, 11, 11, 11]) },
  ]);
  assert.equal(p.lapCount, 5);
  const dnf = p.drivers[0]!;
  assert.equal(dnf.lapsCompleted, 3);
  assert.deepEqual(dnf.positions, [1, 1, 1]);
  assert.deepEqual(p.drivers[1]!.positions, [2, 2, 2, 1, 1]);
  assert.deepEqual(p.drivers[2]!.positions, [3, 3, 3, 2, 2]);
  // Once the leader is gone, the gap is read to the new leader.
  assert.deepEqual(p.drivers[2]!.gaps, [2, 4, 6, 4, 5]);
});

test("lap 0 counts as run-in time when every driver has one", () => {
  const p = buildRaceProgress([
    { id: "a", laps: laps([10, 10], { lap0: 2 }) },
    { id: "b", laps: laps([10, 10], { lap0: 3 }) },
  ]);
  assert.equal(p.lap0Dropped, false);
  assert.equal(p.lapCount, 2);
  assert.deepEqual(p.drivers[0]!.elapsed, [12, 22]);
  assert.deepEqual(p.drivers[1]!.gaps, [1, 1]);
});

test("lap 0 is dropped from everyone when only some drivers carry it", () => {
  const p = buildRaceProgress([
    { id: "a", laps: laps([10, 10], { lap0: 2 }) },
    { id: "b", laps: laps([10, 10]) },
  ]);
  assert.equal(p.lap0Dropped, true);
  assert.deepEqual(p.drivers[0]!.elapsed, [10, 20]);
  assert.deepEqual(p.drivers[0]!.gaps, [0, 0]);
});

test("a driver with no laps is carried with empty lines, not dropped", () => {
  const p = buildRaceProgress([
    { id: "a", laps: laps([10]) },
    { id: "dns", laps: [] },
  ]);
  assert.equal(p.drivers.length, 2);
  assert.deepEqual(p.drivers[1], { id: "dns", elapsed: [], gaps: [], positions: [], lapsCompleted: 0 });
});

test("pace range reads clean laps only and ranks by average", () => {
  const ranges = buildPaceRanges([
    // Average 17.0 on clean laps; the 36s lap is a crash, not pace.
    { id: "crasher", laps: laps([16.6, 17.0, 17.4, 36.1, 17.0, 17.0]) },
    { id: "steady", laps: laps([16.9, 16.9, 16.9, 16.9, 16.9, 16.9]) },
  ]);
  assert.deepEqual(
    ranges.map((r) => r.id),
    ["steady", "crasher"]
  );
  const crasher = ranges[1]!;
  assert.equal(crasher.slowest, 17.4);
  assert.equal(crasher.cleanCount, 5);
  assert.equal(crasher.offPaceCount, 1);
  assert.equal(crasher.ranked, true);
});

test("too few clean laps: shown last, never ranked, however quick", () => {
  const few = Array.from({ length: MIN_CLEAN_LAPS_FOR_PACE_RANGE - 1 }, () => 16.4);
  const ranges = buildPaceRanges([
    { id: "three-lap-hero", laps: laps(few) },
    { id: "full-run", laps: laps([17, 17, 17, 17, 17, 17, 17]) },
    { id: "no-laps", laps: [] },
  ]);
  assert.deepEqual(
    ranges.map((r) => r.id),
    ["full-run", "three-lap-hero", "no-laps"]
  );
  assert.equal(ranges[1]!.ranked, false);
  assert.equal(ranges[1]!.best, 16.4);
  assert.equal(ranges[2]!.best, null);
});
