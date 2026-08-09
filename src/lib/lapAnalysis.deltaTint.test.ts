/**
 * Run: `npx tsx --test src/lib/lapAnalysis.deltaTint.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELTA_MAX_ABS_RANGE,
  DELTA_TINT_MIN_RANGE,
  getDeltaStyle,
  resolveDeltaTintRange,
} from "@/lib/lapAnalysis";

/** Alpha out of an `rgba(r, g, b, a)` string. */
function alphaOf(style: { backgroundColor: string }): number {
  const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(style.backgroundColor);
  assert.ok(m, `no alpha in ${style.backgroundColor}`);
  return Number(m![1]);
}

// Deltas off a real onroad session: nothing near the old fixed 1.0s range.
const REAL_DELTAS = [0.084, -0.079, -0.043, -0.029, -0.156, 0.038, 0.059, -0.057, -0.074, 0.219, -0.054];

test("a realistic grid uses most of the colour ramp, where the fixed range used a sliver", () => {
  const range = resolveDeltaTintRange(REAL_DELTAS);
  const strongest = Math.max(...REAL_DELTAS.map(Math.abs));

  const before = alphaOf(getDeltaStyle(strongest, DELTA_MAX_ABS_RANGE));
  const after = alphaOf(getDeltaStyle(strongest, range));

  // The biggest delta in the session used to tint at ~16% — barely visible.
  assert.ok(before < 0.2, `expected a washed-out ${before} under the fixed range`);
  // Now it reaches full strength.
  assert.ok(after >= 0.45, `expected a strong tint, got ${after}`);
});

test("p90, not max, so one survivor outlier can't flatten the rest", () => {
  const withOutlier = [...REAL_DELTAS, 3.4];
  const range = resolveDeltaTintRange(withOutlier);
  // A 3.4s lap would set a range that puts every real lap back in the washed-out band.
  assert.ok(range < 1.0, `outlier set the range to ${range}`);
  const typical = alphaOf(getDeltaStyle(0.156, range));
  assert.ok(typical > 0.2, `a typical lap washed out to ${typical}`);
});

test("a metronomic run is not amplified into a screaming grid", () => {
  // Every lap within a few hundredths — real, but nothing worth colouring loudly.
  const range = resolveDeltaTintRange([0.004, -0.006, 0.003, -0.002, 0.005]);
  assert.equal(range, DELTA_TINT_MIN_RANGE);
  assert.ok(alphaOf(getDeltaStyle(0.005, range)) < 0.12);
});

test("range stays clamped at both ends", () => {
  assert.equal(resolveDeltaTintRange([]), DELTA_TINT_MIN_RANGE);
  assert.equal(resolveDeltaTintRange([0, 0, 0]), DELTA_TINT_MIN_RANGE);
  assert.equal(resolveDeltaTintRange([12, 14, 20]), DELTA_MAX_ABS_RANGE);
  assert.equal(resolveDeltaTintRange([Number.NaN, Number.POSITIVE_INFINITY]), DELTA_TINT_MIN_RANGE);
});

test("colour semantics are untouched: slower is red, quicker is green", () => {
  const range = resolveDeltaTintRange(REAL_DELTAS);
  assert.match(getDeltaStyle(0.15, range).backgroundColor, /^rgba\(229, 100, 78/);
  assert.match(getDeltaStyle(-0.15, range).backgroundColor, /^rgba\(79, 208, 137/);
  assert.match(getDeltaStyle(0, range).backgroundColor, /^rgba\(128, 128, 128/);
  assert.equal(getDeltaStyle(Number.NaN, range).backgroundColor, "transparent");
});

test("alpha never exceeds the legibility cap", () => {
  const range = resolveDeltaTintRange(REAL_DELTAS);
  for (const d of [...REAL_DELTAS, 99, -99]) {
    assert.ok(alphaOf(getDeltaStyle(d, range)) <= 0.5, `${d} exceeded the cap`);
  }
});
