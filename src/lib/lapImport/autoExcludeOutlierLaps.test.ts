/**
 * Run: `npx tsx src/lib/lapImport/autoExcludeOutlierLaps.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LapRow } from "@/lib/lapAnalysis";
import {
  applyMedianBandAutoExclude,
  DEFAULT_LAP_OUTLIER_RELATIVE_BAND,
  DEFAULT_MIN_LAPS_FOR_OUTLIER_RULE,
} from "@/lib/lapImport/autoExcludeOutlierLaps";

function rows(times: number[]): LapRow[] {
  return times.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: true,
  }));
}

test("no-op when fewer than min laps", () => {
  const r = rows([20, 21, 22]);
  const out = applyMedianBandAutoExclude(r);
  assert.deepEqual(
    out.map((x) => x.isIncluded),
    [true, true, true]
  );
});

test("excludes slow outlier beyond 1.5x median", () => {
  const r = rows([20, 20, 20, 20, 60]);
  const out = applyMedianBandAutoExclude(r, {
    band: DEFAULT_LAP_OUTLIER_RELATIVE_BAND,
    minLaps: DEFAULT_MIN_LAPS_FOR_OUTLIER_RULE,
  });
  assert.equal(out[4]!.isIncluded, false);
  assert.ok(out.slice(0, 4).every((x) => x.isIncluded));
});

test("excludes fast outlier below 0.5x median", () => {
  const r = rows([5, 20, 20, 20, 20]);
  const out = applyMedianBandAutoExclude(r);
  assert.equal(out[0]!.isIncluded, false);
});

test("re-includes closest laps until at least 2 remain when band excludes almost all", () => {
  const r = rows([100, 200, 300, 400]);
  const out = applyMedianBandAutoExclude(r, { band: 0.5, minLaps: 4, minIncluded: 2 });
  const inc = out.filter((l) => l.lapNumber !== 0 && l.isIncluded);
  assert.ok(inc.length >= 2);
});

test("lap 0 row is not used for median and is passed through", () => {
  const r: LapRow[] = [
    { lapNumber: 0, lapTimeSeconds: 999, isIncluded: true },
    ...rows([20, 20, 20, 20]),
  ];
  const out = applyMedianBandAutoExclude(r);
  assert.equal(out[0]!.lapNumber, 0);
  assert.equal(out[0]!.isIncluded, true);
});
