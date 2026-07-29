import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineContextLabel,
  cleanBaselineName,
  cleanBaselineNotes,
  MAX_BASELINE_NAME_LENGTH,
  parseBaselineGripLevel,
  parseBaselineKind,
  parseBaselineSurface,
  sortBaselineSetups,
} from "@/lib/baselineSetups/baselineSetupShape";

test("only the three published kinds are accepted", () => {
  assert.equal(parseBaselineKind("KIT"), "KIT");
  assert.equal(parseBaselineKind("BASE"), "BASE");
  assert.equal(parseBaselineKind("PRO"), "PRO");
  assert.equal(parseBaselineKind("CONDITION"), null);
  assert.equal(parseBaselineKind("kit"), null);
  assert.equal(parseBaselineKind(undefined), null);
});

test("optional tags clear rather than fail on junk", () => {
  assert.equal(parseBaselineSurface("carpet"), "carpet");
  assert.equal(parseBaselineSurface("grass"), null);
  assert.equal(parseBaselineGripLevel("high"), "high");
  assert.equal(parseBaselineGripLevel(""), null);
  assert.equal(parseBaselineGripLevel(3), null);
});

test("names are trimmed, capped, and empty means missing", () => {
  assert.equal(cleanBaselineName("  Kit setup  "), "Kit setup");
  assert.equal(cleanBaselineName("   "), null);
  assert.equal(cleanBaselineName(null), null);
  assert.equal(cleanBaselineName("x".repeat(200))?.length, MAX_BASELINE_NAME_LENGTH);
});

test("notes are optional and normalize blank to null", () => {
  assert.equal(cleanBaselineNotes("  works from medium grip up "), "works from medium grip up");
  assert.equal(cleanBaselineNotes("\n\n"), null);
});

test("context label reads naturally with either tag, both, or neither", () => {
  assert.equal(baselineContextLabel({ surface: "carpet", gripLevel: "high" }), "Carpet · high grip");
  assert.equal(baselineContextLabel({ surface: "asphalt", gripLevel: null }), "Asphalt");
  assert.equal(baselineContextLabel({ surface: null, gripLevel: "low" }), "low grip");
  assert.equal(baselineContextLabel({ surface: null, gripLevel: null }), null);
});

test("kit sorts first, then base, then pro, and ties keep query order", () => {
  const sorted = sortBaselineSetups([
    { kind: "PRO" as const, name: "Volker" },
    { kind: "KIT" as const, name: "Kit" },
    { kind: "PRO" as const, name: "Rheinard" },
    { kind: "BASE" as const, name: "Factory base" },
  ]);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["Kit", "Factory base", "Volker", "Rheinard"]
  );
});
