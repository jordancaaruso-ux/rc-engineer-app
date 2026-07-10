/**
 * Run: `npx tsx src/lib/dashboardRecords.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeDashboardRecords,
  recordMetricLabel,
  type RecordRunInput,
} from "@/lib/dashboardRecords";

const at = (iso: string) => new Date(iso);

function run(
  p: Partial<RecordRunInput> & { runId: string; effectiveAt: Date }
): RecordRunInput {
  return {
    trackId: "trackA",
    trackName: "Track A",
    className: "17.5",
    bestLapSeconds: null,
    avgTop5Seconds: null,
    lapTimes: [],
    lapSession: null,
    ...p,
  };
}

test("groups a track+class and keeps the all-time min for each metric", () => {
  const { records } = computeDashboardRecords([
    run({ runId: "1", effectiveAt: at("2026-07-01T00:00:00Z"), bestLapSeconds: 21, avgTop5Seconds: 21.5 }),
    run({ runId: "2", effectiveAt: at("2026-07-05T00:00:00Z"), bestLapSeconds: 20, avgTop5Seconds: 21.0 }),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].bestLap, 20);
  assert.equal(records[0].avgTop5, 21.0);
  assert.equal(records[0].runsCount, 2);
});

test("track+class are separate records, ranked most-recent-active first", () => {
  const { records } = computeDashboardRecords([
    run({ runId: "a", effectiveAt: at("2026-07-01T00:00:00Z"), trackId: "A", trackName: "Alpha", className: "17.5", bestLapSeconds: 20 }),
    run({ runId: "b", effectiveAt: at("2026-07-09T00:00:00Z"), trackId: "B", trackName: "Bravo", className: "Mod", bestLapSeconds: 18 }),
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].trackName, "Bravo"); // most recent run first
  assert.equal(records[1].trackName, "Alpha");
});

test("same track, different class stay separate", () => {
  const { records } = computeDashboardRecords([
    run({ runId: "1", effectiveAt: at("2026-07-01T00:00:00Z"), className: "17.5" }),
    run({ runId: "2", effectiveAt: at("2026-07-02T00:00:00Z"), className: "Mod" }),
  ].map((r) => ({ ...r, bestLapSeconds: 20 })));
  assert.equal(records.length, 2);
});

test("race pace = best average over any 5 CONSECUTIVE laps (from lap times)", () => {
  const { records } = computeDashboardRecords([
    // five 20s sit consecutively in the middle; the fast tail isn't 5-long
    run({ runId: "1", effectiveAt: at("2026-07-01T00:00:00Z"), lapTimes: [22, 21, 20, 20, 20, 20, 20, 25] }),
  ]);
  assert.equal(records[0].racePace, 20);
  assert.equal(records[0].bestLap, 20); // min lap, computed from times (no materialized)
});

test("race pace is null when a run has fewer than five laps", () => {
  const { records } = computeDashboardRecords([
    run({ runId: "1", effectiveAt: at("2026-07-01T00:00:00Z"), lapTimes: [20, 21, 22] }),
  ]);
  assert.equal(records[0].racePace, null);
});

test("fresh PB: the most recent run beating a prior best flags newPb + the record", () => {
  const { records, newPb } = computeDashboardRecords(
    [
      run({ runId: "old", effectiveAt: at("2026-07-01T00:00:00Z"), bestLapSeconds: 20.5, avgTop5Seconds: 21 }),
      run({ runId: "new", effectiveAt: at("2026-07-05T00:00:00Z"), bestLapSeconds: 20.2, avgTop5Seconds: 21.2 }),
    ],
    "new"
  );
  assert.ok(newPb);
  assert.equal(newPb.metric, "best");
  assert.equal(newPb.value, 20.2);
  assert.equal(newPb.previousValue, 20.5);
  assert.equal(records[0].freshPbMetric, "best");
});

test("a first run at a track is not a PB (nothing to beat)", () => {
  const { records, newPb } = computeDashboardRecords(
    [run({ runId: "only", effectiveAt: at("2026-07-05T00:00:00Z"), bestLapSeconds: 19 })],
    "only"
  );
  assert.equal(newPb, null);
  assert.equal(records[0].freshPbMetric, null);
});

test("no PB when the most recent run did not beat the record", () => {
  const { newPb } = computeDashboardRecords(
    [
      run({ runId: "old", effectiveAt: at("2026-07-01T00:00:00Z"), bestLapSeconds: 19 }),
      run({ runId: "new", effectiveAt: at("2026-07-05T00:00:00Z"), bestLapSeconds: 20 }),
    ],
    "new"
  );
  assert.equal(newPb, null);
});

test("runs without a track are skipped (no comparable record key)", () => {
  const { records } = computeDashboardRecords([
    run({ runId: "x", effectiveAt: at("2026-07-01T00:00:00Z"), trackId: null, bestLapSeconds: 18 }),
  ]);
  assert.equal(records.length, 0);
});

test("recordMetricLabel copy", () => {
  assert.equal(recordMetricLabel("best"), "best lap");
  assert.equal(recordMetricLabel("avgTop5"), "best avg top-5");
  assert.equal(recordMetricLabel("racePace"), "best race pace");
});
