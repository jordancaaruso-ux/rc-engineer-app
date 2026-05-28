/**
 * Run: `npx tsx src/lib/setupCalibrations/pdfFieldMappingOwnership.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pruneGroupedRuleOptionKeys,
  pruneOrphanCalibrationMappingKeys,
} from "@/lib/setupCalibrations/pdfFieldMappingOwnership";

test("pruneOrphanCalibrationMappingKeys drops removed parameter keys", () => {
  const mappings = {
    top_deck_screw_a: { mode: "singleChoiceNamedFields" as const, options: {} },
    top_deck_screws: {
      mode: "multiSelectNamedFields" as const,
      options: { A: { pdfFieldName: "cb1", widgetInstanceIndex: 0 } },
    },
  };
  const next = pruneOrphanCalibrationMappingKeys(mappings, new Set(["top_deck_screws"]));
  assert.equal(Object.keys(next).length, 1);
  assert.ok(next.top_deck_screws);
});

test("pruneGroupedRuleOptionKeys removes deleted option values", () => {
  const rule = {
    mode: "multiSelectNamedFields" as const,
    options: {
      A: { pdfFieldName: "cb1", widgetInstanceIndex: 0 },
      Z: { pdfFieldName: "cb9", widgetInstanceIndex: 0 },
    },
  };
  const next = pruneGroupedRuleOptionKeys(rule, new Set(["A", "B", "C"]));
  assert.ok(next && "options" in next);
  assert.deepEqual(Object.keys(next.options).sort(), ["A"]);
});
