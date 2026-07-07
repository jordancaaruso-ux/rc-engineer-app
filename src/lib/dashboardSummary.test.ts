/**
 * Run: `npx tsx src/lib/dashboardSummary.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeDashboardSummary,
  formatDrivingDuration,
  summaryChangeChip,
  type SummaryRunInput,
} from "@/lib/dashboardSummary";

const NOW = new Date("2026-07-06T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function run(partial: Partial<SummaryRunInput> & { effectiveAt: Date }): SummaryRunInput {
  return {
    lapCount: 10,
    drivingSeconds: 300,
    bestLapSeconds: 20,
    trackId: "trackA",
    trackName: "Track A",
    className: "17.5",
    ...partial,
  };
}

test("buckets runs into current vs prior 30-day windows", () => {
  const rows = [
    run({ effectiveAt: daysAgo(1) }), // current
    run({ effectiveAt: daysAgo(29) }), // current
    run({ effectiveAt: daysAgo(40) }), // prior
    run({ effectiveAt: daysAgo(70) }), // outside both
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.runs.current, 2);
  assert.equal(s.runs.prior, 1);
  assert.equal(s.laps.current, 20);
  assert.equal(s.laps.prior, 10);
  assert.equal(s.drivingSeconds.current, 600);
  assert.equal(s.hasData, true);
});

test("counts distinct active days and tracks in the current window", () => {
  const rows = [
    run({ effectiveAt: new Date("2026-07-06T08:00:00Z"), trackId: "trackA" }),
    run({ effectiveAt: new Date("2026-07-06T09:00:00Z"), trackId: "trackA" }), // same day+track
    run({ effectiveAt: new Date("2026-07-05T09:00:00Z"), trackId: "trackB" }), // new day+track
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.activeDays, 2);
  assert.equal(s.tracks, 2);
});

test("pace trend is per track+class and needs >=2 runs", () => {
  const rows = [
    // trackA/17.5: two runs, improving (slower -> faster)
    run({ effectiveAt: daysAgo(10), trackId: "trackA", className: "17.5", bestLapSeconds: 21 }),
    run({ effectiveAt: daysAgo(2), trackId: "trackA", className: "17.5", bestLapSeconds: 20 }),
    // trackB: single run, ignored for trend
    run({ effectiveAt: daysAgo(3), trackId: "trackB", className: "13.5", bestLapSeconds: 18 }),
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.ok(s.pace, "expected a pace trend");
  assert.equal(s.pace?.trackName, "Track A");
  assert.equal(s.pace?.className, "17.5");
  assert.equal(s.pace?.runsCount, 2);
  assert.equal(s.pace?.firstBestLap, 21);
  assert.equal(s.pace?.lastBestLap, 20);
  assert.equal(s.pace?.deltaSeconds, -1); // negative = faster
  assert.deepEqual(s.pace?.spark, [21, 20]);
});

test("does not mix tracks/classes into one pace line", () => {
  const rows = [
    run({ effectiveAt: daysAgo(10), trackId: "trackA", className: "17.5", bestLapSeconds: 21 }),
    run({ effectiveAt: daysAgo(2), trackId: "trackB", className: "17.5", bestLapSeconds: 20 }),
  ];
  // Two different tracks, one run each → no group reaches 2 runs.
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.pace, null);
});

test("most-active track+class wins the pace slot", () => {
  const rows = [
    run({ effectiveAt: daysAgo(9), trackId: "trackA", bestLapSeconds: 21 }),
    run({ effectiveAt: daysAgo(8), trackId: "trackA", bestLapSeconds: 20 }),
    run({ effectiveAt: daysAgo(7), trackId: "trackA", bestLapSeconds: 19 }),
    run({ effectiveAt: daysAgo(6), trackId: "trackB", bestLapSeconds: 15 }),
    run({ effectiveAt: daysAgo(5), trackId: "trackB", bestLapSeconds: 15 }),
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.pace?.trackName, "Track A");
  assert.equal(s.pace?.runsCount, 3);
});

test("paceByTrack ranks every 2+-run track+class, headline first", () => {
  const rows = [
    // trackA: 3 runs (most active — should rank first and be `pace`)
    run({ effectiveAt: daysAgo(9), trackId: "trackA", trackName: "Track A", bestLapSeconds: 21 }),
    run({ effectiveAt: daysAgo(8), trackId: "trackA", trackName: "Track A", bestLapSeconds: 20 }),
    run({ effectiveAt: daysAgo(7), trackId: "trackA", trackName: "Track A", bestLapSeconds: 19 }),
    // trackB: 2 runs, getting slower
    run({ effectiveAt: daysAgo(6), trackId: "trackB", trackName: "Track B", bestLapSeconds: 15 }),
    run({ effectiveAt: daysAgo(5), trackId: "trackB", trackName: "Track B", bestLapSeconds: 15.4 }),
    // trackC: 1 run — no trend
    run({ effectiveAt: daysAgo(4), trackId: "trackC", trackName: "Track C", bestLapSeconds: 12 }),
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.paceByTrack.length, 2);
  assert.equal(s.paceByTrack[0].trackName, "Track A");
  assert.equal(s.paceByTrack[1].trackName, "Track B");
  assert.equal(s.paceByTrack[1].deltaSeconds.toFixed(1), "0.4"); // slower
  // Headline pace is always the first ranked entry.
  assert.equal(s.pace?.trackName, s.paceByTrack[0].trackName);
});

test("activityByDay bins runs per local day, oldest → newest", () => {
  const rows = [
    run({ effectiveAt: daysAgo(0) }), // today → last slot
    run({ effectiveAt: daysAgo(0) }), // same day
    run({ effectiveAt: daysAgo(29) }), // window start → first slot
    run({ effectiveAt: daysAgo(40) }), // prior window — excluded
  ];
  const s = computeDashboardSummary(rows, NOW, "UTC");
  assert.equal(s.activityByDay.length, 30);
  assert.equal(s.activityByDay[29], 2);
  assert.equal(s.activityByDay[0], 1);
  assert.equal(
    s.activityByDay.reduce((a, b) => a + b, 0),
    3
  );
});

test("empty window reports no data", () => {
  const s = computeDashboardSummary([run({ effectiveAt: daysAgo(90) })], NOW, "UTC");
  assert.equal(s.hasData, false);
  assert.equal(s.runs.current, 0);
  assert.equal(s.pace, null);
});

test("formatDrivingDuration renders human wheel time", () => {
  assert.equal(formatDrivingDuration(0), "0m");
  assert.equal(formatDrivingDuration(180), "3m");
  assert.equal(formatDrivingDuration(47 * 60), "47m");
  assert.equal(formatDrivingDuration(2 * 3600 + 14 * 60), "2h 14m");
  assert.equal(formatDrivingDuration(3600), "1h");
});

test("summaryChangeChip signals direction", () => {
  assert.equal(summaryChangeChip({ current: 5, prior: 3 }).direction, "up");
  assert.equal(summaryChangeChip({ current: 2, prior: 6 }).direction, "down");
  assert.equal(summaryChangeChip({ current: 4, prior: 4 }).direction, "flat");
  assert.equal(summaryChangeChip({ current: 5, prior: 3 }).label, "+2 vs prior 30d");
});
