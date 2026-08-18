import test from "node:test";
import assert from "node:assert/strict";
import { buildGroupRunRows, type WorkbenchGroupSource } from "@/lib/runs/sessionWorkbenchModel";

/**
 * The Sessions run rows show best / top 5 / top 10 side by side, and the two
 * averages are the reason these tests exist: `getAverageTopN` slices to
 * `min(n, laps)`, so on a short run it returns the average of everything it has.
 * Printed under a "Top 10" heading that is a different statistic wearing the
 * same label — a 7-lap run's plain average reading as race pace over ten laps.
 * `buildGroupRunRows` is the only thing standing between that and the screen.
 */

function run(id: string, lapTimes: number[]) {
  return { id, carId: "car_1", car: { name: "A800RR" }, createdAt: new Date(), lapTimes };
}

/** n laps, all distinct so best/top5/top10 can't coincide by accident. */
function laps(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 16.0 + i * 0.1);
}

function group(runs: WorkbenchGroupSource["runs"]): WorkbenchGroupSource {
  return { title: "Test day", type: "Testing", runs };
}

test("a run with 10+ laps carries both averages", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(18))]));
  assert.equal(row!.lapCount, 18);
  assert.equal(row!.best, 16.0);
  // Fastest five are 16.0 … 16.4; fastest ten are 16.0 … 16.9.
  assert.ok(Math.abs(row!.avgTop5! - 16.2) < 1e-9);
  assert.ok(Math.abs(row!.avgTop10! - 16.45) < 1e-9);
});

test("under 10 laps, top 10 is null rather than the run's plain average", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(7))]));
  assert.equal(row!.lapCount, 7);
  assert.equal(row!.avgTop10, null, "7 laps cannot produce a top 10");
  // Top 5 is still honest at 7 laps, so it stays.
  assert.ok(Math.abs(row!.avgTop5! - 16.2) < 1e-9);
});

test("under 5 laps, both averages are null", () => {
  const [row] = buildGroupRunRows(group([run("r1", laps(3))]));
  assert.equal(row!.avgTop5, null);
  assert.equal(row!.avgTop10, null);
  // Best is one lap, so it survives where an average of five cannot.
  assert.equal(row!.best, 16.0);
});

test("exactly 5 and exactly 10 laps are inside the boundary, not outside it", () => {
  const [five] = buildGroupRunRows(group([run("r1", laps(5))]));
  assert.notEqual(five!.avgTop5, null);
  assert.equal(five!.avgTop10, null);

  const [ten] = buildGroupRunRows(group([run("r2", laps(10))]));
  assert.notEqual(ten!.avgTop5, null);
  assert.notEqual(ten!.avgTop10, null);
});

test("a run with no laps carries no figures at all", () => {
  const [row] = buildGroupRunRows(group([run("r1", [])]));
  assert.equal(row!.best, null);
  assert.equal(row!.avgTop5, null);
  assert.equal(row!.avgTop10, null);
  assert.equal(row!.lapCount, 0);
});

test("only the fastest run in the group is marked, and green rides on best", () => {
  const rows = buildGroupRunRows(
    group([run("slow", [16.5, 16.6, 16.7]), run("fast", [15.9, 16.1, 16.2])])
  );
  const marked = rows.filter((r) => r.isGroupBest);
  assert.equal(marked.length, 1);
  assert.equal(marked[0]!.id, "fast");
});
