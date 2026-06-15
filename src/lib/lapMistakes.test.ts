/**
 * Run: `npx tsx src/lib/lapMistakes.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LapRow } from "@/lib/lapAnalysis";
import { computeMistakeLaps } from "@/lib/lapAnalysis";

function rows(times: number[]): LapRow[] {
  return times.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: true,
  }));
}

test("not eligible below 6 laps", () => {
  const r = computeMistakeLaps(rows([15.0, 15.1, 15.0, 15.1, 16.0]));
  assert.equal(r.eligible, false);
  assert.equal(r.mistakeCount, 0);
});

test("tight stint: +0.5s slow lap counts at 0.5s floor", () => {
  const r = computeMistakeLaps(rows([300.0, 300.05, 300.1, 300.1, 300.12, 300.62]));
  assert.equal(r.eligible, true);
  assert.equal(r.mistakeCount, 1);
  assert.equal(r.mistakes[0]?.lapNumber, 6);
  assert.ok((r.mistakes[0]?.deltaSec ?? 0) >= 0.5);
});

test("loose stint: +0.5s off median is not a mistake", () => {
  const r = computeMistakeLaps(rows([29.0, 29.5, 30.0, 30.2, 30.4, 30.5]));
  assert.equal(r.eligible, true);
  assert.equal(r.mistakeCount, 0);
  assert.ok((r.thresholdSec ?? 0) > 0.5);
});

test("slow-only: fast lap is never a mistake", () => {
  const r = computeMistakeLaps(rows([15.0, 15.0, 15.0, 15.0, 15.0, 14.0]));
  assert.equal(r.mistakeCount, 0);
});

test("lap 1 can be a mistake", () => {
  const r = computeMistakeLaps(rows([20.0, 15.0, 15.0, 15.0, 15.0, 15.0]));
  assert.equal(r.mistakeCount, 1);
  assert.equal(r.mistakes[0]?.lapNumber, 1);
});

console.log("lapMistakes.test.ts OK");
