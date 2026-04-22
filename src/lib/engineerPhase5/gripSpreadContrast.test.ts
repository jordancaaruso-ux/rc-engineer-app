/**
 * Run: `npx tsx src/lib/engineerPhase5/gripSpreadContrast.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeGripSpreadContrast, type MedianTrendSignalForSpread } from "./gripSpreadContrast";
import type { GripTrendBucketStats } from "@/lib/setupAggregations/loadCommunityAggregations";

function b(
  median: number,
  iqr: number,
  sampleCount: number,
  mean?: number
): GripTrendBucketStats {
  return {
    sampleCount,
    median,
    mean: mean ?? median,
    min: median - 2 * iqr,
    max: median + 2 * iqr,
    p25: median - iqr / 2,
    p75: median + iqr / 2,
    iqr,
    stdDev: iqr * 0.4,
    topValues: [],
    distinctValueCount: 1,
    valueHistogram: { [String(median)]: sampleCount },
  };
}

const PARAM = "z_test_param_spread";
/** Default min delta 0.1; medians 3 vs 3.05 => flat */
const signalFlat: MedianTrendSignalForSpread = { magnitude: "flat" };

test("same medians, very different IQR => material spread contrast, wider in high", () => {
  const trend = {
    low: b(3, 0.1, 20),
    high: b(3, 0.4, 20),
  };
  const out = computeGripSpreadContrast(PARAM, trend, signalFlat);
  assert.ok(out);
  assert.equal(out.magnitude, "material");
  assert.equal(out.widerIn, "high");
  assert.ok(out.iqrRatio >= 2);
  assert.equal(out.endpoints[0], "low");
  assert.equal(out.endpoints[1], "high");
});

test("medians differ beyond min delta => no spread row (trend is not flat)", () => {
  const trend = {
    low: b(1, 0.1, 20),
    high: b(3, 0.5, 20),
  };
  const out = computeGripSpreadContrast(PARAM, trend, { magnitude: "slight" });
  assert.equal(out, null);
});

test("IQR ratio below slight threshold => null", () => {
  const trend = {
    low: b(2, 0.5, 20),
    high: b(2, 0.6, 20),
  };
  const out = computeGripSpreadContrast(PARAM, trend, signalFlat);
  assert.equal(out, null);
});

test("IQR ratio in slight band => slight magnitude", () => {
  const trend = {
    low: b(3, 0.1, 20),
    high: b(3, 0.16, 20),
  };
  const out = computeGripSpreadContrast(PARAM, trend, signalFlat);
  assert.ok(out);
  assert.equal(out.magnitude, "slight");
  assert.ok(out.iqrRatio >= 1.4);
  assert.ok(out.iqrRatio < 2);
});

test("undersampled bucket => null", () => {
  const trend = {
    low: b(3, 0.1, 8),
    high: b(3, 0.4, 20),
  };
  const out = computeGripSpreadContrast(PARAM, trend, signalFlat);
  assert.equal(out, null);
});

test("skew note when mean and median disagree strongly vs IQR", () => {
  const low: GripTrendBucketStats = {
    ...b(2, 0.1, 20),
    mean: 2.15,
    median: 2,
  };
  const high = b(2, 0.3, 20);
  const trend = { low, high };
  const out = computeGripSpreadContrast(PARAM, trend, signalFlat);
  assert.ok(out?.skewNote?.includes("low") && out.skewNote.includes("mean_median"));
});
