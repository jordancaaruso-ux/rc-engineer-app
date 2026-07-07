/**
 * Run: `npx tsx src/lib/analysis/analysisHomeModel.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bestDeltaVsPreviousSameCarTrack,
  collectCarOptions,
  computeAnalysisRunMetrics,
  isTrackCarPersonalBest,
  medianOf,
  resolveTrendScope,
  runMatchesScope,
  runRowTitle,
  shortRunLabel,
} from "@/lib/analysis/analysisHomeModel";

test("medianOf: odd, even, empty, non-finite", () => {
  assert.equal(medianOf([25.1, 24.9, 25.3]), 25.1);
  assert.ok(Math.abs((medianOf([25.0, 25.2, 25.4, 25.6]) ?? 0) - 25.3) < 1e-9);
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([Number.NaN, 25.0]), 25.0);
});

test("computeAnalysisRunMetrics prefers stored columns, computes top10 + median", () => {
  // 12 laps 25.0 .. 26.1
  const lapTimes = Array.from({ length: 12 }, (_, i) => 25.0 + i * 0.1);
  const metrics = computeAnalysisRunMetrics({
    lapTimes,
    bestLapSeconds: 24.987, // stored wins over computed 25.0
    avgTop5LapSeconds: 25.123,
  });
  assert.equal(metrics.best, 24.987);
  assert.equal(metrics.avgTop5, 25.123);
  // top 10 of 25.0..26.1 = mean(25.0..25.9) = 25.45
  assert.ok(Math.abs((metrics.avgTop10 ?? 0) - 25.45) < 1e-9);
  // median of 12 laps = (25.5 + 25.6) / 2
  assert.ok(Math.abs((metrics.median ?? 0) - 25.55) < 1e-9);
  assert.equal(metrics.cleanLapCount, 12);
});

test("computeAnalysisRunMetrics falls back to computing when columns are null", () => {
  const metrics = computeAnalysisRunMetrics({
    lapTimes: [25.4, 25.2, 25.9],
    bestLapSeconds: null,
    avgTop5LapSeconds: null,
  });
  assert.equal(metrics.best, 25.2);
  assert.ok(Math.abs((metrics.avgTop5 ?? 0) - (25.4 + 25.2 + 25.9) / 3) < 1e-9);
});

test("computeAnalysisRunMetrics: empty laps → nulls, zero count", () => {
  const metrics = computeAnalysisRunMetrics({ lapTimes: [] });
  assert.equal(metrics.best, null);
  assert.equal(metrics.median, null);
  assert.equal(metrics.cleanLapCount, 0);
  assert.equal(metrics.consistencyScore, null);
  assert.equal(metrics.mistakeCount, null);
});

test("computeAnalysisRunMetrics: consistency + mistakes on a real run", () => {
  // 8 steady laps + one blow-up: consistency is a score, the spike is a mistake.
  const metrics = computeAnalysisRunMetrics({
    lapTimes: [25.0, 25.1, 25.0, 25.2, 25.1, 25.0, 25.1, 25.0, 31.5],
  });
  assert.ok(metrics.consistencyScore != null && metrics.consistencyScore > 0);
  assert.ok(metrics.consistencyScore! <= 100);
  assert.equal(metrics.mistakeCount, 1);
});

test("shortRunLabel: code wins, short label used, else R{n}", () => {
  assert.equal(shortRunLabel({ meetingSessionCode: "Q2" }, 4), "Q2");
  assert.equal(shortRunLabel({ sessionLabel: "Shakedwn" }, 0), "Shakedwn");
  assert.equal(shortRunLabel({ sessionLabel: "A very long session label" }, 2), "R3");
  assert.equal(shortRunLabel({}, 0), "R1");
});

test("runRowTitle: meeting session + car; session-type fallback when no label", () => {
  assert.equal(
    runRowTitle({
      sessionType: "RACE_MEETING",
      meetingSessionType: "QUALIFYING",
      carName: "A800 RR",
    }),
    "Qualifying · A800 RR"
  );
  assert.equal(runRowTitle({ sessionType: "TESTING", carName: "A800 RR" }), "Testing · A800 RR");
  assert.equal(runRowTitle({ sessionType: "TESTING" }), "Testing");
});

test("resolveTrendScope: event wins; else calendar day in timezone", () => {
  const eventScope = resolveTrendScope(
    { eventId: "ev1", createdAt: new Date("2026-07-03T06:00:00Z") },
    "Australia/Sydney"
  );
  assert.deepEqual(eventScope, { kind: "event", eventId: "ev1" });

  const dayScope = resolveTrendScope(
    // 23:30 UTC Jul 2 = Jul 3 in Sydney
    { eventId: null, createdAt: new Date("2026-07-02T23:30:00Z") },
    "Australia/Sydney"
  );
  assert.deepEqual(dayScope, { kind: "day", ymd: "2026-07-03" });
});

test("runMatchesScope: day scope respects timezone day boundaries", () => {
  const scope = { kind: "day" as const, ymd: "2026-07-03" };
  const tz = "Australia/Sydney";
  assert.equal(
    runMatchesScope({ eventId: null, createdAt: new Date("2026-07-03T08:00:00Z") }, scope, tz),
    true
  );
  // Jul 3 15:00 UTC = Jul 4 01:00 Sydney → different day
  assert.equal(
    runMatchesScope({ eventId: null, createdAt: new Date("2026-07-03T15:00:00Z") }, scope, tz),
    false
  );
});

test("bestDeltaVsPreviousSameCarTrack: same car+track only, skips other combos", () => {
  const runs = [
    { carId: "c1", trackId: "t1", best: 25.0 }, // newest
    { carId: "c2", trackId: "t1", best: 26.0 }, // other car — skipped
    { carId: "c1", trackId: "t1", best: 25.4 }, // ← baseline
  ];
  const delta = bestDeltaVsPreviousSameCarTrack(runs, 0);
  assert.ok(delta != null && Math.abs(delta - -0.4) < 1e-9);
  // No older same-combo run
  assert.equal(bestDeltaVsPreviousSameCarTrack(runs, 2), null);
  // Missing car/track/best → null
  assert.equal(
    bestDeltaVsPreviousSameCarTrack([{ carId: null, trackId: "t1", best: 25.0 }], 0),
    null
  );
});

test("isTrackCarPersonalBest: float tolerance, null guards", () => {
  assert.equal(isTrackCarPersonalBest(24.81, 24.81), true);
  assert.equal(isTrackCarPersonalBest(24.810049, 24.81), true);
  assert.equal(isTrackCarPersonalBest(24.83, 24.81), false);
  assert.equal(isTrackCarPersonalBest(null, 24.81), false);
  assert.equal(isTrackCarPersonalBest(24.81, null), false);
});

test("collectCarOptions: distinct, first-seen order, null car bucket", () => {
  const options = collectCarOptions([
    { carId: "c1", carName: "A800 RR" },
    { carId: "c2", carName: "Xray T4" },
    { carId: "c1", carName: "A800 RR" },
    { carId: null, carName: "Unknown car" },
  ]);
  assert.deepEqual(options, [
    { carId: "c1", carName: "A800 RR" },
    { carId: "c2", carName: "Xray T4" },
    { carId: null, carName: "Unknown car" },
  ]);
});
