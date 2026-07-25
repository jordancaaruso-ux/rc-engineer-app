import assert from "node:assert/strict";
import test from "node:test";

import { parameterNameSuggestions } from "@/lib/setupSheetModels/parameterNameSuggestions";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

function field(partial: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: partial.key,
    sectionId: "general",
    sectionTitle: "General",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 0,
    ...partial,
  };
}

function schema(fields: SetupSheetModelFieldDef[] = []): SetupSheetModelSchema {
  return { version: 1, label: "Test sheet", structuredSections: [], fields };
}

test("an empty query suggests nothing — the panel autofocuses the name box", () => {
  assert.deepEqual(parameterNameSuggestions(schema(), ""), []);
  assert.deepEqual(parameterNameSuggestions(schema(), "   "), []);
});

test("universal concepts are offered as bare stems, pre-selecting front/rear", () => {
  const out = parameterNameSuggestions(schema(), "cam");
  assert.deepEqual(out, [
    { stem: "Camber", suggestedSplit: "front_rear", existingPositions: [], source: "universal" },
  ]);
});

test("the 16 registry entries collapse to one stem per concept", () => {
  const stems = parameterNameSuggestions(schema(), "e", 40).map((s) => s.stem);
  assert.deepEqual(new Set(stems).size, stems.length);
  assert.ok(stems.includes("Camber"));
  assert.ok(stems.includes("Ride height"));
  assert.ok(!stems.includes("Camber (Front)"));
});

test("a stem already on the sheet wins over the universal entry and reports its positions", () => {
  const out = parameterNameSuggestions(
    schema([field({ key: "camber_front", displayLabel: "Camber (Front)" })]),
    "camber"
  );
  assert.deepEqual(out, [
    {
      stem: "Camber",
      suggestedSplit: "front_rear",
      existingPositions: ["Front"],
      source: "sheet",
    },
  ]);
});

test("per-corner keys pre-select the four-corner split", () => {
  const out = parameterNameSuggestions(
    schema([
      field({ key: "upper_inner_shims_ff", displayLabel: "Upper inner shims (FF)" }),
      field({ key: "upper_inner_shims_rr", displayLabel: "Upper inner shims (RR)" }),
    ]),
    "upper"
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.stem, "Upper inner shims");
  assert.equal(out[0]!.suggestedSplit, "corner4");
  assert.deepEqual(out[0]!.existingPositions, ["FF", "RR"]);
});

test("a name with no position stays a single parameter", () => {
  const out = parameterNameSuggestions(
    schema([field({ key: "total_weight", displayLabel: "Total weight" })]),
    "total"
  );
  assert.deepEqual(out, [
    { stem: "Total weight", suggestedSplit: "single", existingPositions: [], source: "sheet" },
  ]);
});

test("matching is case-insensitive and substring, and the limit is honoured", () => {
  const s = schema([
    field({ key: "front_droop", displayLabel: "Droop (Front)" }),
    field({ key: "rear_droop", displayLabel: "Droop (Rear)" }),
  ]);
  assert.equal(parameterNameSuggestions(s, "DROOP")[0]!.stem, "Droop");
  assert.deepEqual(parameterNameSuggestions(s, "roo")[0]!.existingPositions, ["Front", "Rear"]);
  assert.equal(parameterNameSuggestions(schema(), "o", 2).length, 2);
});
