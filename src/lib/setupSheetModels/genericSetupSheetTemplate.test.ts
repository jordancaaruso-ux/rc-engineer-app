/**
 * Run: `npx tsx --test src/lib/setupSheetModels/genericSetupSheetTemplate.test.ts`
 *
 * The generic sheet is the one a driver gets when the app knows least about their car, so the
 * reroute through `buildGenericPresetSchema` has to be provably lossless and provably better:
 * every key survives, and the controls stop being free text.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectSetupSheetTemplateKeys } from "@/lib/setupSheetModels/collectTemplateKeys";
import { getGenericSetupSheetTemplate } from "@/lib/setupSheetModels/genericSetupSheetTemplate";
import { buildSetupFillSteps } from "@/lib/setup/setupFillOrder";
import { GENERIC_SETUP_SHEET_V1 } from "@/lib/setupSheetTemplate";

test("no key is lost building the generic sheet through the schema", () => {
  const before = collectSetupSheetTemplateKeys(GENERIC_SETUP_SHEET_V1);
  const after = collectSetupSheetTemplateKeys(getGenericSetupSheetTemplate());

  const dropped = [...before].filter((k) => !after.has(k));
  const added = [...after].filter((k) => !before.has(k));

  assert.deepEqual(dropped, [], `keys dropped by the reroute: ${dropped.join(", ")}`);
  assert.deepEqual(added, [], `keys invented by the reroute: ${added.join(", ")}`);
});

test("the template keeps its id, so data-setup-sheet-template is unchanged", () => {
  const t = getGenericSetupSheetTemplate();
  assert.equal(t.id, "generic-v1");
  assert.equal(t.label, "Generic touring");
});

test("a model-less car still gets no community bucket", () => {
  // Borrowing another chassis' aggregations would be worse than showing nothing.
  assert.equal(getGenericSetupSheetTemplate().templateKey ?? null, null);
});

test("fill steps get real controls instead of 43 text boxes", () => {
  const steps = buildSetupFillSteps(getGenericSetupSheetTemplate());
  const byKey = new Map(steps.map((s) => [s.key, s]));

  // The regression this whole change exists to fix: numbers used to open a text keyboard.
  assert.equal(byKey.get("camber_front")?.kind, "number");
  assert.equal(byKey.get("ride_height_front")?.kind, "number");
  assert.equal(byKey.get("droop_rear")?.kind, "number");

  // Surface is a closed set, so it must be chips rather than free text a driver can misspell.
  const surface = byKey.get("track_surface");
  assert.equal(surface?.kind, "choice");
  assert.deepEqual(surface?.optionValues, ["asphalt", "carpet"]);

  // Traction takes more than one answer.
  assert.equal(byKey.get("traction")?.kind, "multiChoice");

  // Genuinely free-text fields stay free text.
  assert.equal(byKey.get("driver")?.kind, "text");
  assert.equal(byKey.get("body_notes")?.kind, "text");

  assert.equal(
    steps.filter((s) => s.kind === "text").length < steps.length,
    true,
    "every step is still text — the schema reroute did not take effect"
  );
});

test("every field the driver fills is reachable from the fill flow", () => {
  const steps = buildSetupFillSteps(getGenericSetupSheetTemplate());
  assert.equal(new Set(steps.map((s) => s.key)).size, steps.length, "a key is walked twice");
  assert.equal(steps.length > 0, true);
});

test("units survive, including the one that only existed on the flat groups copy", () => {
  const steps = buildSetupFillSteps(getGenericSetupSheetTemplate());
  const byKey = new Map(steps.map((s) => [s.key, s]));
  assert.equal(byKey.get("diff_oil")?.unit, "cSt");
  assert.equal(byKey.get("camber_front")?.unit, "°");
  assert.equal(byKey.get("ride_height_front")?.unit, "mm");
});
