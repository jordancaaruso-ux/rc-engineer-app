/**
 * Run: `npx tsx src/lib/analysis/analysisHomeModel.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bestDeltaVsPreviousSameCarTrack,
  collectCarOptions,
  computeAnalysisRunMetrics,
  computeLapDistribution,
  computeSetupChangesByRunId,
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

test("computeLapDistribution: quartiles ordered, no mistakes on a clean run", () => {
  // 12 laps 25.0 .. 26.1
  const lapTimes = Array.from({ length: 12 }, (_, i) => 25.0 + i * 0.1);
  const d = computeLapDistribution({ lapTimes });
  assert.ok(d != null);
  assert.ok(d!.best <= d!.p25);
  assert.ok(d!.p25 <= d!.median);
  assert.ok(d!.median <= d!.p75);
  assert.ok(d!.p75 <= d!.slowestClean);
  assert.ok(Math.abs(d!.best - 25.0) < 1e-9);
  assert.ok(Math.abs(d!.median - 25.55) < 1e-9);
  // IQR here is 0.55, so the threshold is 2×IQR = 1.1 — nothing reaches it.
  assert.deepEqual(d!.mistakes, []);
  assert.ok(Math.abs(d!.slowestClean - 26.1) < 1e-9);
});

test("computeLapDistribution: no box until the mistake rule also applies", () => {
  // The floor is MIN_LAPS_FOR_MISTAKES, not "enough to compute quartiles". A
  // 5-lap run can compute a Q1/Q3 but can't have a mistake, so its crash lap
  // would sit on the top whisker while the same lap in a longer run plots as a
  // dot — one event, two drawings, depending only on stint length.
  assert.equal(computeLapDistribution({ lapTimes: [25.0, 25.1, 25.2] }), null);
  assert.equal(computeLapDistribution({ lapTimes: [] }), null);
  assert.equal(computeLapDistribution({ lapTimes: [25.0, 25.1, 25.2, 25.3, 31.0] }), null);
  assert.ok(computeLapDistribution({ lapTimes: [25.0, 25.1, 25.2, 25.3, 25.4, 25.5] }) != null);
});

test("computeLapDistribution: a crash lap is a dot at the floor, not a whisker", () => {
  // Exactly at the floor: the blow-up is classified, so the whisker stays clean.
  const d = computeLapDistribution({ lapTimes: [25.0, 25.1, 25.2, 25.3, 25.15, 31.0] });
  assert.ok(d != null);
  assert.deepEqual(d!.mistakes, [31.0]);
  assert.ok(Math.abs(d!.slowestClean - 25.3) < 1e-9);
  assert.ok(Math.abs(d!.best - 25.0) < 1e-9);
});

test("computeLapDistribution: a crash lap becomes a dot, not the top whisker", () => {
  const d = computeLapDistribution({
    lapTimes: [25.0, 25.1, 25.0, 25.2, 25.1, 25.0, 25.1, 25.0, 31.5],
  });
  assert.ok(d != null);
  assert.deepEqual(d!.mistakes, [31.5]);
  assert.ok(Math.abs(d!.slowestClean - 25.2) < 1e-9);
  assert.ok(d!.slowestClean < d!.mistakes[0]);
  // Same rule the Mistakes face counts by — these must never disagree.
  const metrics = computeAnalysisRunMetrics({
    lapTimes: [25.0, 25.1, 25.0, 25.2, 25.1, 25.0, 25.1, 25.0, 31.5],
  });
  assert.equal(metrics.mistakeCount, d!.mistakes.length);
});

test("computeLapDistribution: identical laps collapse to a flat box", () => {
  const d = computeLapDistribution({ lapTimes: [25.0, 25.0, 25.0, 25.0, 25.0, 25.0] });
  assert.ok(d != null);
  assert.equal(d!.best, 25.0);
  assert.equal(d!.p25, 25.0);
  assert.equal(d!.median, 25.0);
  assert.equal(d!.p75, 25.0);
  assert.equal(d!.slowestClean, 25.0);
  assert.deepEqual(d!.mistakes, []);
});

test("computeLapDistribution: Q3 may land above the slowest clean lap", () => {
  // 9 tidy laps + 3 blow-ups. Q3's interpolation index (8.25 of 12) straddles the
  // clean/mistake boundary, so Q3 lands in the gap: above every clean lap, below
  // every mistake. The chart draws no upper whisker there. Seen on 2 of 146
  // mistake-eligible runs in the demo season, so it is worth pinning.
  const lapTimes = [25.1, 25.0, 25.3, 25.05, 27.0, 25.2, 25.1, 28.0, 25.15, 25.0, 27.5, 25.25];
  const d = computeLapDistribution({ lapTimes });
  assert.ok(d != null);
  assert.deepEqual(d!.mistakes, [27.0, 27.5, 28.0]);
  assert.ok(Math.abs(d!.slowestClean - 25.3) < 1e-9);
  assert.ok(d!.p75 > d!.slowestClean, "Q3 above the slowest clean lap is legal here");
  // The invariants that DO hold everywhere.
  assert.ok(d!.best <= d!.p25 && d!.p25 <= d!.median && d!.median <= d!.p75);
  assert.ok(d!.mistakes.every((m) => m > d!.slowestClean));
  // Quartiles span every included lap, so the median bar is the same number the
  // Line view's Median series plots. If this drifts, the morph lies.
  assert.equal(d!.median, computeAnalysisRunMetrics({ lapTimes }).median);
});

test("computeLapDistribution: duplicate lap times are classified independently", () => {
  // Two laps share the slowest clean time; flagging one must not drop both.
  const lapTimes = [25.0, 25.1, 25.2, 25.2, 25.0, 25.1, 25.0, 31.5];
  const d = computeLapDistribution({ lapTimes });
  assert.ok(d != null);
  assert.deepEqual(d!.mistakes, [31.5]);
  assert.ok(Math.abs(d!.slowestClean - 25.2) < 1e-9);
});

test("computeLapDistribution: excluded laps do not move the quartiles", () => {
  const base = Array.from({ length: 12 }, (_, i) => 25.0 + i * 0.1);
  const expected = computeLapDistribution({ lapTimes: base });
  // Same run plus a towed-in lap the user un-ticked in run review.
  const withExcluded = computeLapDistribution({
    lapTimes: [...base, 40.0],
    lapSession: {
      version: 1,
      entries: [
        {
          perLap: [...base.map(() => ({ isIncluded: true })), { isIncluded: false }],
        },
      ],
    },
  });
  assert.deepEqual(withExcluded, expected);
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

test("computeSetupChangesByRunId: diffs vs previous run on same car, skips first + tires", () => {
  // Newest-first, one car. r3 changed camber; r2 only swapped tires (excluded);
  // r1 is the first run (no baseline).
  const changes = computeSetupChangesByRunId([
    { id: "r3", carId: "c1", setupData: { camber_front: -3.0, tires: "set B" } },
    { id: "r2", carId: "c1", setupData: { camber_front: -2.5, tires: "set B" } },
    { id: "r1", carId: "c1", setupData: { camber_front: -2.5, tires: "set A" } },
  ]);
  // r3 vs r2: camber changed → marked (label carries the field unit).
  assert.deepEqual(changes.get("r3"), { changedFieldLabels: ["Camber (Front) (°)"] });
  // r2 vs r1: only tires differ (excluded) → no marker.
  assert.equal(changes.has("r2"), false);
  // r1: no previous run on this car → no marker.
  assert.equal(changes.has("r1"), false);
});

test("computeSetupChangesByRunId: compares within a car, not across cars", () => {
  const changes = computeSetupChangesByRunId([
    { id: "b2", carId: "c2", setupData: { spring_front: 2.5 } },
    { id: "a2", carId: "c1", setupData: { spring_front: 3.0 } },
    { id: "b1", carId: "c2", setupData: { spring_front: 2.4 } },
    { id: "a1", carId: "c1", setupData: { spring_front: 3.0 } },
  ]);
  // b2 diffs against b1 (its own car), not the interleaved a2.
  assert.deepEqual(changes.get("b2"), { changedFieldLabels: ["Spring (Front)"] });
  // a2 vs a1: identical → no marker.
  assert.equal(changes.has("a2"), false);
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
