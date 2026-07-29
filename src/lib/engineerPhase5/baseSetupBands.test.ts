/**
 * Run: `npx tsx --test src/lib/engineerPhase5/baseSetupBands.test.ts`
 *
 * Covers the base-setup position-band path: bands built from the setups published against a chassis,
 * used only where community/garage aggregations don't reach. The band edges are what decide whether
 * the Engineer's out-of-window hedge fires (`computeHedgedAtPosition`), so they're pinned here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_SETUP_SHOULDER_STEPS,
  baseSetupStatsFromValues,
  synthesizeBaseSetupStats,
} from "@/lib/engineerPhase5/baseSetupBands";
import {
  baseSetupConditionValueForKey,
  baseSetupValuesForKey,
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

test("a single published sheet stays sampleCount 1 so nothing reads it as a distribution", () => {
  const s = synthesizeBaseSetupStats(30, 5);
  assert.ok(s);
  assert.equal(s.sampleCount, 1);
  assert.deepEqual(s.valueHistogram, {});
  assert.equal(s.distinctValueCount, 0);
  // Same via the values entry point — one value can't invent a width.
  assert.deepEqual(baseSetupStatsFromValues([30], 5), s);
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
  assert.equal(baseSetupStatsFromValues([], 5), null);
  assert.equal(baseSetupStatsFromValues([30], null), null); // one sheet, no authored step
});

test("several published sheets give the range they actually span", () => {
  // Four sheets across conditions, as a manufacturer publishes them.
  const s = baseSetupStatsFromValues([4.8, 5, 5.2, 5.4], null)!;
  assert.equal(s.sampleCount, 4);
  assert.equal(s.min, 4.8);
  assert.equal(s.max, 5.4);
  // The published range IS the edge — no tail invented past what they used.
  assert.equal(s.p10, 4.8);
  assert.equal(s.p90, 5.4);
  assert.equal(s.distinctValueCount, 4);
  // No authored step needed once the sheets disagree.
  assert.ok(s.iqr > 0);
});

test("outside the published range reads as extreme, inside it does not", () => {
  const s = baseSetupStatsFromValues([4.8, 5, 5.2, 5.4], null)!;
  assert.equal(bandFor(5.1, s), "mid"); // squarely among the published sheets
  assert.equal(bandFor(4.8, s), "low"); // the lowest they publish, but still published
  assert.equal(bandFor(5.4, s), "high"); // the highest they publish
  assert.equal(bandFor(4.5, s), "below_typical"); // softer than any published sheet
  assert.equal(bandFor(6, s), "above_typical"); // stiffer than any published sheet
});

test("sheets that all agree have no width, so they fall back to the step window", () => {
  const agreed = baseSetupStatsFromValues([30, 30, 30], 5)!;
  assert.deepEqual(agreed, synthesizeBaseSetupStats(30, 5));
  // Without an authored step there is nothing to widen with — no bands rather than zero width.
  assert.equal(baseSetupStatsFromValues([30, 30, 30], null), null);
});

test("sampleCount stays under the soft-prior gate until five sheets are published", () => {
  // softPriorsFromAggregation gates at MIN_SAMPLES = 5. Four authored sheets must not graduate.
  assert.equal(baseSetupStatsFromValues([1, 2, 3, 4], null)!.sampleCount, 4);
  assert.equal(baseSetupStatsFromValues([1, 2, 3, 4, 5], null)!.sampleCount, 5);
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


/** A published sheet, with the surface/grip tags an admin sets on it. */
function sheet(
  name: string,
  surface: string | null,
  gripLevel: string | null,
  data: Record<string, unknown>
) {
  return { name, surface, gripLevel, data };
}

const MI10 = [
  sheet("Low grip, asphalt", "asphalt", "low", { ride_height_front: 5.2, camber_front: "-2" }),
  sheet("Medium grip, asphalt", "asphalt", "medium", { ride_height_front: 5, camber_front: "-2" }),
  sheet("High grip, asphalt", "asphalt", "high", { ride_height_front: "4,8" }),
  sheet("Medium grip, carpet", "carpet", "medium", { ride_height_front: 5.6, camber_front: "-1" }),
];

test("base reference is null when the chassis has no usable baselines", () => {
  const args = { modelName: "X", runSurface: null, runGripLevel: null } as const;
  assert.equal(buildBaseSetupReference({ ...args, baselines: [] }), null);
  assert.equal(
    buildBaseSetupReference({ ...args, baselines: [sheet("Kit", null, null, null as never)] }),
    null
  );
  assert.equal(
    buildBaseSetupReference({ ...args, baselines: [sheet("Kit", null, null, {})] }),
    null
  );
});

test("surface is a hard gate — an asphalt run never sees the carpet sheet", () => {
  const base = buildBaseSetupReference({
    baselines: MI10,
    modelName: "Schumacher Mi10",
    runSurface: "asphalt",
    runGripLevel: "medium",
  })!;
  assert.equal(base.ref.surfaceScope, "matched");
  assert.equal(base.ref.surface, "asphalt");
  assert.equal(base.ref.baselineCount, 3);
  assert.ok(!base.ref.baselineNames.includes("Medium grip, carpet"));
  // 5.6 from the carpet sheet must not widen the asphalt range.
  assert.deepEqual(baseSetupValuesForKey(base, "ride_height_front"), [5.2, 5, 4.8]);
  assert.equal(baseSetupStatsFromValues(baseSetupValuesForKey(base, "ride_height_front"), null)!.max, 5.2);
});

test("one sheet for the surface is the honest answer, not a reason to borrow the other", () => {
  const base = buildBaseSetupReference({
    baselines: MI10,
    modelName: "Schumacher Mi10",
    runSurface: "carpet",
    runGripLevel: "medium",
  })!;
  assert.equal(base.ref.baselineCount, 1);
  assert.deepEqual(base.ref.baselineNames, ["Medium grip, carpet"]);
  assert.deepEqual(baseSetupValuesForKey(base, "ride_height_front"), [5.6]);
  // Widened by the authored step, at sampleCount 1 — never by the asphalt sheets.
  const stats = baseSetupStatsFromValues(baseSetupValuesForKey(base, "ride_height_front"), 0.2)!;
  assert.equal(stats.sampleCount, 1);
  assert.equal(stats.median, 5.6);
});

test("no sheet for the run's surface means no reference at all", () => {
  const base = buildBaseSetupReference({
    baselines: [MI10[0]!, MI10[1]!, MI10[2]!], // asphalt only
    modelName: "Schumacher Mi10",
    runSurface: "carpet",
    runGripLevel: "medium",
  });
  assert.equal(base, null);
});

test("untagged sheets apply anywhere, but only when nothing claims the surface", () => {
  const anySurface = sheet("Kit setup", null, null, { ride_height_front: 5.1 });
  // Nothing claims carpet, so the untagged kit sheet is the fallback.
  const fallback = buildBaseSetupReference({
    baselines: [MI10[0]!, anySurface],
    modelName: "X",
    runSurface: "carpet",
    runGripLevel: null,
  })!;
  assert.equal(fallback.ref.surfaceScope, "untagged_only");
  assert.deepEqual(fallback.ref.baselineNames, ["Kit setup"]);

  // An asphalt sheet exists, so the tagged one wins and the untagged one drops out.
  const matched = buildBaseSetupReference({
    baselines: [MI10[0]!, anySurface],
    modelName: "X",
    runSurface: "asphalt",
    runGripLevel: null,
  })!;
  assert.equal(matched.ref.surfaceScope, "matched");
  assert.deepEqual(matched.ref.baselineNames, ["Low grip, asphalt"]);
});

test("unknown surface can't gate, so the range is flagged as mixed", () => {
  const base = buildBaseSetupReference({
    baselines: MI10,
    modelName: "Schumacher Mi10",
    runSurface: null,
    runGripLevel: "medium",
  })!;
  assert.equal(base.ref.surfaceScope, "mixed");
  assert.equal(base.ref.surface, null);
  assert.equal(base.ref.baselineCount, 4);
});

test("grip is not a gate — it names the sheet written for these conditions", () => {
  const base = buildBaseSetupReference({
    baselines: MI10,
    modelName: "Schumacher Mi10",
    runSurface: "asphalt",
    runGripLevel: "high",
  })!;
  // All three asphalt sheets still set the range...
  assert.equal(base.ref.baselineCount, 3);
  // ...but the high-grip one is the anchor for a recommendation.
  assert.equal(base.ref.conditionMatchName, "High grip, asphalt");
  assert.deepEqual(baseSetupConditionValueForKey(base, "ride_height_front"), {
    baselineName: "High grip, asphalt",
    value: 4.8,
  });
  // That sheet carries no camber, so there's no anchor for it rather than a borrowed one.
  assert.equal(baseSetupConditionValueForKey(base, "camber_front"), null);
});

test("an unknown grip bucket matches no sheet", () => {
  for (const grip of ["any", null]) {
    const base = buildBaseSetupReference({
      baselines: MI10,
      modelName: "X",
      runSurface: "asphalt",
      runGripLevel: grip,
    })!;
    assert.equal(base.ref.conditionMatchName, null);
    assert.equal(baseSetupConditionValueForKey(base, "ride_height_front"), null);
  }
});

test("base values parse the same way a driver's own values do", () => {
  const base = buildBaseSetupReference({
    baselines: [
      sheet("Kit setup", null, null, {
        camber_front: "-1.5",
        front_spring_rate_gf_mm: 30,
        ride_height_front: "5,5 mm", // European decimal comma, as OCR'd sheets produce
        chassis: "2.0mm carbon",
      }),
    ],
    modelName: "Awesomatix A800RR",
    runSurface: "asphalt",
    runGripLevel: "medium",
  })!;
  assert.equal(base.ref.modelName, "Awesomatix A800RR");
  assert.equal(base.ref.baselineCount, 1);
  assert.deepEqual(baseSetupValuesForKey(base, "camber_front"), [-1.5]);
  assert.deepEqual(baseSetupValuesForKey(base, "front_spring_rate_gf_mm"), [30]);
  assert.deepEqual(baseSetupValuesForKey(base, "ride_height_front"), [5.5]);
  assert.deepEqual(baseSetupValuesForKey(base, "missing_key"), []);
});

test("a categorical base value yields no centre, so no window", () => {
  const base = buildBaseSetupReference({
    baselines: [sheet("Kit", null, null, { chassis: "2.0mm carbon", camber_front: "-1.5" })],
    modelName: "X",
    runSurface: null,
    runGripLevel: null,
  })!;
  // Two independent guards, either one enough to suppress the band:
  assert.equal(getParameterStep("chassis"), null); // no step authored for a part choice
  assert.deepEqual(baseSetupValuesForKey(base, "chassis"), []); // and it normalizes to a preset/other
  // object, which never reads as a number — so "2.0mm carbon" can't leak through as a centre of 2.
});

test("derived geometry keys read from computed metrics, not raw data", () => {
  const base = buildBaseSetupReference({
    baselines: [sheet("Kit", null, null, { camber_front: "-1.5" })],
    modelName: "X",
    runSurface: null,
    runGripLevel: null,
  })!;
  // No platform pack matches this sparse data, so derived metrics are null — and null means no band.
  assert.deepEqual(baseSetupValuesForKey(base, "derived_roll_center_front_mm"), []);
});

test("an unknown surface gets a range but no anchor — picking one would be a coin toss", () => {
  const base = buildBaseSetupReference({
    baselines: MI10,
    modelName: "Schumacher Mi10",
    runSurface: null,
    runGripLevel: "medium", // matches BOTH the asphalt and the carpet medium sheet
  })!;
  assert.equal(base.ref.surfaceScope, "mixed");
  assert.equal(base.ref.conditionMatchName, null);
  assert.equal(baseSetupConditionValueForKey(base, "ride_height_front"), null);
});
