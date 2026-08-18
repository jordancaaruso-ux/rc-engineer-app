/**
 * Run: `npx tsx src/lib/lapImport/blockLapRows.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getBestLap, getIncludedLaps } from "@/lib/lapAnalysis";
import type { UrlImportBlock } from "@/components/runs/LapTimesIngestPanel";
import {
  blockJoinLapNumbers,
  orderBlocksByTrackTime,
  primaryPerLapAcrossBlocks,
  primaryRowsAcrossBlocks,
} from "@/lib/lapImport/blockLapRows";

function block(
  id: string,
  times: number[],
  iso: string | null,
  opts?: { included?: boolean[]; recordedAt?: string; flagged?: boolean[] }
): UrlImportBlock {
  const driverId = `d-${id}`;
  return {
    blockId: id,
    importedSessionId: `sess-${id}`,
    sourceUrl: `https://liverc.com/${id}`,
    parserId: "liverc_deterministic_v1",
    recordedAt: opts?.recordedAt ?? "2026-08-18T09:00:00.000Z",
    sessionCompletedAtDbIso: iso,
    sessionCompletedAtIso: iso,
    sessionDrivers: [
      {
        id: driverId,
        driverId,
        driverName: "Split Tester",
        normalizedName: "split tester",
        laps: times,
        lapCount: times.length,
      },
    ],
    selectedDriverIds: [driverId],
    driverLapRowsByDriverId: {
      [driverId]: times.map((t, i) => ({
        lapNumber: i + 1,
        lapTimeSeconds: t,
        isIncluded: opts?.included?.[i] ?? true,
      })),
    },
    urlLapRows: opts?.flagged
      ? times.map((t, i) => ({
          time: t,
          isFlagged: opts.flagged![i] ?? false,
          flagReason: null,
          isOutlierWarning: false,
          warningReason: null,
        }))
      : null,
  };
}

const FIRST = block("a", [19.84, 18.92, 18.61], "2026-08-18T04:14:00.000Z");
const SECOND = block("b", [19.35, 18.41], "2026-08-18T04:29:00.000Z");

test("one import: rows pass through unchanged", () => {
  const rows = primaryRowsAcrossBlocks([FIRST]);
  assert.deepEqual(rows.map((r) => r.lapTimeSeconds), [19.84, 18.92, 18.61]);
  assert.deepEqual(rows.map((r) => r.lapNumber), [1, 2, 3]);
  assert.deepEqual(blockJoinLapNumbers([FIRST]), [], "a single import has no join");
});

test("no imports", () => {
  assert.deepEqual(primaryRowsAcrossBlocks([]), []);
  assert.deepEqual(blockJoinLapNumbers([]), []);
});

test("two halves join, renumbered, on-track order", () => {
  const rows = primaryRowsAcrossBlocks([SECOND, FIRST]);
  assert.deepEqual(
    rows.map((r) => r.lapTimeSeconds),
    [19.84, 18.92, 18.61, 19.35, 18.41],
    "array order must not beat session time"
  );
  assert.deepEqual(rows.map((r) => r.lapNumber), [1, 2, 3, 4, 5]);
  assert.equal(getIncludedLaps(rows).length, 5, "no lap dropped by the lap-0 filter");
});

test("the run's best lap can come from the second half", () => {
  assert.equal(getBestLap(primaryRowsAcrossBlocks([FIRST])), 18.61);
  assert.equal(getBestLap(primaryRowsAcrossBlocks([FIRST, SECOND])), 18.41);
});

test("join marker sits on the first lap of the second half", () => {
  assert.deepEqual(blockJoinLapNumbers([FIRST, SECOND]), [4]);
  assert.deepEqual(blockJoinLapNumbers([SECOND, FIRST]), [4], "ordered before counting");
});

test("three imports give two joins", () => {
  const third = block("c", [18.9], "2026-08-18T04:44:00.000Z");
  assert.deepEqual(blockJoinLapNumbers([FIRST, SECOND, third]), [4, 6]);
  assert.equal(primaryRowsAcrossBlocks([FIRST, SECOND, third]).length, 6);
});

test("excluded laps stay excluded across the join", () => {
  const withExcluded = block("a", [19.84, 40.1, 18.61], "2026-08-18T04:14:00.000Z", {
    included: [true, false, true],
  });
  const rows = primaryRowsAcrossBlocks([withExcluded, SECOND]);
  assert.deepEqual(rows.map((r) => r.isIncluded), [true, false, true, true, true]);
  assert.equal(getBestLap(rows), 18.41);
});

test("per-lap flags line up with the joined rows, per block", () => {
  const flaggedFirst = block("a", [19.84, 18.92, 18.61], "2026-08-18T04:14:00.000Z", {
    flagged: [true, false, false],
  });
  const perLap = primaryPerLapAcrossBlocks([flaggedFirst, SECOND]);
  assert.equal(perLap.length, 5, "must match the joined lap count exactly");
  assert.deepEqual(
    perLap.map((p) => p.isFlagged),
    [true, false, false, false, false],
    "the first half's flag must not land on the second half's laps"
  );
});

test("ordering falls back to import time when the session time is unknown", () => {
  const untimed = block("z", [17.5], null, { recordedAt: "2026-08-18T10:00:00.000Z" });
  const ordered = orderBlocksByTrackTime([untimed, FIRST]);
  assert.deepEqual(ordered.map((b) => b.blockId), ["a", "z"]);
});

test("a block with no selected driver contributes nothing", () => {
  const unselected: UrlImportBlock = { ...SECOND, selectedDriverIds: [] };
  const rows = primaryRowsAcrossBlocks([FIRST, unselected]);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    blockJoinLapNumbers([FIRST, unselected]),
    [],
    "no laps means no break — a join here would point past the end of the list"
  );
});
