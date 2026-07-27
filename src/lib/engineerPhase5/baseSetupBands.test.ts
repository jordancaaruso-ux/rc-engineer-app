/**
 * Run: `npx tsx --test src/lib/engineerPhase5/baseSetupBands.test.ts`
 *
 * Covers the base-setup position-band path: a window synthesized around a chassis' kit setup, used
 * only where community/garage aggregations don't reach. The band edges are what decide whether the
 * Engineer's out-of-window hedge fires (`computeHedgedAtPosition`), so they're pinned here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_SETUP_SHOULDER_STEPS,
  synthesizeBaseSetupStats,
} from "@/lib/engineerPhase5/baseSetupBands";
import {
  baseSetupValueForKey,
  buildBaseSetupReference,
} from "@/lib/setup/resolveBaseSetupForCar";
import { getParameterStep } from "@/lib/setup/parameterStepSizes";

/** Mirror of the private `bandForValue` in setupSpreadForEngineer — same cuts, kept in sync by these tests. */
function bandFor(v: number, s: { p10: number; p25: number; p75: number; p90: number }): string {
  if (v < s.p10) return "below_typical";
  if (v < s.p25) return "low";
  if (v <= s.p75) return "mid";
  if (v <= s.p90) return "high";
  return "above_typical";
}

test("window is centred on the base value, one step wide at mid", () => {
  const s = synthesizeBaseSetupStats(30, 5);
  assert.ok(s);
  assert.equal(s.median, 30);
  assert.equal(s.p50, 30);
  assert.equal(s.p25, 25);
  assert.equal(s.p75, 35);
  assert.equal(s.p10, 30 - 5 * BASE_SETUP_SHOULDER_STEPS);
  assert.equal(s.p90, 30 + 5 * BASE_SETUP_SHOULDER_STEPS);
  assert.equal(s.iqr, 10);
});

test("sampleCount stays 1 so nothing reads it as a distribution", () => {
  const s = synthesizeBaseSetupStats(30, 5);
  assert.ok(s);
  // softPriorsFromAggregation gates at MIN_SAMPLES = 5; 1 must never drift upward.
  assert.equal(s.sampleCount, 1);
  assert.deepEqual(s.valueHistogram, {});
  assert.equal(s.distinctValueCount, 0);
});

test("bands place an already-extreme value past the shoulder", () => {
  const s = synthesizeBaseSetupStats(30, 5)!;
  // Base 30 gf/mm, one grade = 5, shoulder at 3 grades = 15.
  assert.equal(bandFor(30, s), "mid");
  assert.equal(bandFor(26, s), "mid");
  assert.equal(bandFor(22, s), "low");
  assert.equal(bandFor(38, s), "high");
  assert.equal(bandFor(14, s), "below_typical"); // softest — "go softer" must hedge
  assert.equal(bandFor(46, s), "above_typical"); // stiffest — "go stiffer" must hedge
});

test("no width means no window — never guess a step", () => {
  assert.equal(synthesizeBaseSetupStats(30, 0), null);
  assert.equal(synthesizeBaseSetupStats(30, -1), null);
  assert.equal(synthesizeBaseSetupStats(Number.NaN, 5), null);
});

test("step table returns null for categorical and unknown keys", () => {
  assert.equal(getParameterStep("chassis"), null);
  assert.equal(getParameterStep("front_bumper"), null);
  assert.equal(getParameterStep("c45_installed_front"), null);
  assert.equal(getParameterStep("spring_front"), null); // a spring NAME, not a number
  assert.equal(getParameterStep("totally_unknown_key"), null);
});

test("step table resolves the specific prefix before the broader one", () => {
  assert.equal(getParameterStep("spring_gap_rear"), 0.4); // must not fall into bare `spring_`
  assert.equal(getParameterStep("front_spring_rate_gf_mm"), 5);
  assert.equal(getParameterStep("upper_inner_shims_ff"), 0.25);
  assert.equal(getParameterStep("camber_front"), 0.25);
  assert.equal(getParameterStep("diff_oil"), 1000);
});

test("base reference is null when there is no kit setup to read", () => {
  assert.equal(buildBaseSetupReference({ kitSetupJson: null, modelName: "X" }), null);
  assert.equal(buildBaseSetupReference({ kitSetupJson: {}, modelName: "X" }), null);
});

test("base values parse the same way a driver's own values do", () => {
  const base = buildBaseSetupReference({
    kitSetupJson: {
      camber_front: "-1.5",
      front_spring_rate_gf_mm: 30,
      ride_height_front: "5,5 mm", // European decimal comma, as OCR'd sheets produce
      chassis: "2.0mm carbon",
    },
    modelName: "Awesomatix A800RR",
  });
  assert.ok(base);
  assert.equal(base.ref.kind, "kit");
  assert.equal(base.ref.modelName, "Awesomatix A800RR");
  assert.equal(baseSetupValueForKey(base, "camber_front"), -1.5);
  assert.equal(baseSetupValueForKey(base, "front_spring_rate_gf_mm"), 30);
  assert.equal(baseSetupValueForKey(base, "ride_height_front"), 5.5);
  assert.equal(baseSetupValueForKey(base, "missing_key"), null);
});

test("a categorical base value yields no centre, so no window", () => {
  const base = buildBaseSetupReference({
    kitSetupJson: { chassis: "2.0mm carbon", camber_front: "-1.5" },
    modelName: "X",
  })!;
  // Two independent guards, either one enough to suppress the band:
  assert.equal(getParameterStep("chassis"), null); // no step authored for a part choice
  assert.equal(baseSetupValueForKey(base, "chassis"), null); // and it normalizes to a preset/other
  // object, which never reads as a number — so "2.0mm carbon" can't leak through as a centre of 2.
});

test("derived geometry keys read from computed metrics, not raw data", () => {
  const base = buildBaseSetupReference({
    kitSetupJson: { camber_front: "-1.5" },
    modelName: "X",
  })!;
  // No platform pack matches this sparse data, so derived metrics are null — and null means no band.
  assert.equal(baseSetupValueForKey(base, "derived_roll_center_front_mm"), null);
});
