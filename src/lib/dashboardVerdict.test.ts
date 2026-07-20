/**
 * Run: `npx tsx src/lib/dashboardVerdict.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTodayVerdict, type VerdictRunInput } from "@/lib/dashboardVerdict";

function run(partial: Partial<VerdictRunInput> & { runLabel: string }): VerdictRunInput {
  return {
    bestLap: null,
    avgTop5: null,
    top5SpreadSeconds: null,
    changedRows: [],
    ...partial,
  };
}

const change = (label: string, previous: string, current: string) => ({
  key: label.toLowerCase().replace(/\s+/g, "_"),
  label,
  unit: "",
  previous,
  current,
});

test("no runs → null", () => {
  assert.equal(computeTodayVerdict([]), null);
});

test("single run: no trend, best run named, no change verdict", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.1, avgTop5: 15.3, top5SpreadSeconds: 0.12 }),
  ]);
  assert.ok(v);
  assert.equal(v.runCount, 1);
  assert.equal(v.trend, null);
  assert.equal(v.bestRun?.runLabel, "Run 1");
  assert.equal(v.lastChange, null);
  assert.equal(v.consistency?.word, "Tight");
});

test("day trend prefers avg-top-5 and reads faster/slower/steady", () => {
  const faster = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2, avgTop5: 15.4 }),
    run({ runLabel: "Run 2", bestLap: 15.0, avgTop5: 15.15 }),
  ]);
  assert.equal(faster?.trend?.direction, "faster");
  assert.equal(faster?.trend?.metric, "avg");
  assert.ok(Math.abs((faster?.trend?.delta ?? 0) - -0.25) < 1e-9);
  assert.deepEqual(faster?.trend?.spark, [15.4, 15.15]);

  const slower = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.0 }),
    run({ runLabel: "Run 2", avgTop5: 15.3 }),
  ]);
  assert.equal(slower?.trend?.direction, "slower");

  const steady = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.0 }),
    run({ runLabel: "Run 2", avgTop5: 15.02 }),
  ]);
  assert.equal(steady?.trend?.direction, "steady");
});

test("falls back to best lap when fewer than two runs carry an average", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2 }),
    run({ runLabel: "Run 2", bestLap: 15.05, avgTop5: 15.2 }),
  ]);
  assert.equal(v?.trend?.metric, "best");
  assert.equal(v?.trend?.direction, "faster");
});

test("runs without the metric are skipped, not treated as zero", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.4 }),
    run({ runLabel: "Run 2" }), // no laps logged
    run({ runLabel: "Run 3", avgTop5: 15.1 }),
  ]);
  assert.deepEqual(v?.trend?.spark, [15.4, 15.1]);
});

test("best run is the day's fastest lap, not the latest", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 14.9, avgTop5: 15.2 }),
    run({ runLabel: "Run 2", bestLap: 15.1, avgTop5: 15.3 }),
  ]);
  assert.equal(v?.bestRun?.runLabel, "Run 1");
  assert.equal(v?.bestRun?.bestLap, 14.9);
});

test("last change: helped when the changed run gained on the run before it", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.2, avgTop5: 15.45 }),
    run({
      runLabel: "Run 2",
      bestLap: 15.0,
      avgTop5: 15.3,
      changedRows: [change("Front droop", "5.0", "5.5")],
    }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 2");
  assert.equal(v?.lastChange?.verdict, "helped");
  assert.equal(v?.lastChange?.metric, "avg");
  assert.ok(Math.abs((v?.lastChange?.delta ?? 0) - -0.15) < 1e-9);
});

test("last change: hurt, and the LATEST changed run wins", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.3 }),
    run({ runLabel: "Run 2", avgTop5: 15.1, changedRows: [change("Camber", "-2", "-1.5")] }),
    run({ runLabel: "Run 3", avgTop5: 15.35, changedRows: [change("Rear spring", "C6", "C7")] }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 3");
  assert.equal(v?.lastChange?.rows[0]?.label, "Rear spring");
  assert.equal(v?.lastChange?.verdict, "hurt");
});

test("change on the first run of the day → unclear (nothing to compare inside today)", () => {
  const v = computeTodayVerdict([
    run({ runLabel: "Run 1", avgTop5: 15.2, changedRows: [change("Toe", "1", "1.5")] }),
    run({ runLabel: "Run 2", avgTop5: 15.1 }),
  ]);
  assert.equal(v?.lastChange?.runLabel, "Run 1");
  assert.equal(v?.lastChange?.verdict, "unclear");
  assert.equal(v?.lastChange?.delta, null);
});

test("consistency: percent-of-lap thresholds and latest-run-with-laps wins", () => {
  const tight = computeTodayVerdict([
    run({ runLabel: "Run 1", bestLap: 15.0, top5SpreadSeconds: 0.4 }),
    run({ runLabel: "Run 2", bestLap: 15.0, top5SpreadSeconds: 0.12 }),
  ]);
  assert.equal(tight?.consistency?.runLabel, "Run 2");
  assert.equal(tight?.consistency?.word, "Tight");

  const fair = computeTodayVerdict([run({ runLabel: "Run 1", bestLap: 15.0, top5SpreadSeconds: 0.3 })]);
  assert.equal(fair?.consistency?.word, "Fair");

  const scrappy = computeTodayVerdict([run({ runLabel: "Run 1", bestLap: 15.0, top5SpreadSeconds: 0.6 })]);
  assert.equal(scrappy?.consistency?.word, "Scrappy");

  const none = computeTodayVerdict([run({ runLabel: "Run 1", bestLap: 15.0 })]);
  assert.equal(none?.consistency, null);
});
