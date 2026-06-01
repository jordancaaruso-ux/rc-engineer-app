/**
 * Run: `npx tsx src/lib/setupCompare/compareInlineDisplay.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSetupCompareDeltaSuffix } from "@/lib/setupCompare/compareInlineDisplay";
import type { FieldCompareResult } from "@/lib/setupCompare/types";

function result(partial: Partial<FieldCompareResult> & Pick<FieldCompareResult, "areEqual">): FieldCompareResult {
  return {
    key: "test",
    severity: partial.areEqual ? "same" : "minor",
    severityReason: partial.severityReason ?? "value differs",
    normalizedA: partial.normalizedA ?? "1.5",
    normalizedB: partial.normalizedB ?? "1.2",
    ...partial,
  };
}

test("formatSetupCompareDeltaSuffix returns null when equal", () => {
  assert.equal(formatSetupCompareDeltaSuffix(result({ areEqual: true })), null);
});

test("formatSetupCompareDeltaSuffix formats signed delta from normalized values", () => {
  assert.equal(
    formatSetupCompareDeltaSuffix(
      result({
        areEqual: false,
        normalizedA: "1.5",
        normalizedB: "1.2",
      })
    ),
    "(+0.3)"
  );
});

test("formatSetupCompareDeltaSuffix parses magnitude from severityReason", () => {
  assert.equal(
    formatSetupCompareDeltaSuffix(
      result({
        areEqual: false,
        severityReason: "Δ=0.5 (minor)",
        normalizedA: "2",
        normalizedB: "1.5",
      })
    ),
    "(+0.5)"
  );
});
