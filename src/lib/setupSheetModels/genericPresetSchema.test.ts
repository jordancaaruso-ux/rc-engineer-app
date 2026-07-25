import assert from "node:assert/strict";
import { buildGenericPresetSchema } from "@/lib/setupSheetModels/genericPresetSchema";
import { mergeMissingGenericCatalogFields } from "@/lib/setupSheetModels/mergeGenericCatalogFields";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

const schema = buildGenericPresetSchema("Test Chassis");
const keys = new Set(schema.fields.map((f) => f.key));
const fieldBy = (key: string) => schema.fields.find((f) => f.key === key);

// --- The link-geometry stacks the Engineer's roll-centre reasoning runs on ---
for (const key of [
  "upper_inner_shims_ff",
  "upper_inner_shims_fr",
  "upper_inner_shims_rf",
  "upper_inner_shims_rr",
  "under_lower_arm_shims_ff",
  "under_lower_arm_shims_fr",
  "under_lower_arm_shims_rf",
  "under_lower_arm_shims_rr",
  "upper_outer_shims_front",
  "upper_outer_shims_rear",
  "under_hub_shims_front",
  "under_hub_shims_rear",
  "bump_steer_shims_front",
  "toe_gain_shims_rear",
]) {
  assert.equal(keys.has(key), true, `generic preset should carry ${key}`);
  assert.equal(fieldBy(key)?.valueType, "number", `${key} should be numeric`);
  assert.equal(fieldBy(key)?.unit, "mm", `${key} should be in mm`);
}

// A `corner4` row must survive into the layout — the sheet renders from structuredSections, so a
// field present only in `fields` would be invisible to the driver.
const geometry = schema.structuredSections.find((s) => s.id === "geometry");
assert.ok(geometry, "generic preset should have a Link geometry section");
const cornerRows = geometry.rows.filter((r) => r.type === "corner4");
assert.equal(cornerRows.length, 2, "upper inner + under lower arm are four-point rows");

// --- Basics the Engineer names as canonical but the preset used to omit ---
for (const key of ["caster_front", "caster_rear", "downstop_front", "downstop_rear", "diff_oil"]) {
  assert.equal(keys.has(key), true, `generic preset should carry ${key}`);
}

// --- Damper oil uses the KB's spelling, not the old `shock_oil_*` ---
assert.equal(keys.has("damper_oil_front"), true);
assert.equal(keys.has("shock_oil_front"), false);

// --- The manual roll-centre row is retired ---
assert.equal(keys.has("roll_center_front"), false);
assert.equal(keys.has("roll_center_rear"), false);

// --- Cross-car ids come from the registry, so nothing drifts into a near-duplicate ---
assert.equal(fieldBy("damper_oil_front")?.universalParameterId, "damper_oil_front");
assert.equal(fieldBy("spring_rate_front")?.universalParameterId, "spring_front");
assert.equal(fieldBy("upper_inner_shims_ff")?.universalParameterId, "upper_inner_shims_ff");
// Droop and downstop must NOT collapse onto each other.
assert.equal(fieldBy("droop_front")?.universalParameterId, "droop_front");
assert.equal(fieldBy("downstop_front")?.universalParameterId, "downstop_front");

// --- The measurement each one means, since drivers use the words interchangeably ---
assert.match(fieldBy("droop_front")?.notes ?? "", /ground to wheel/i);
assert.match(fieldBy("downstop_front")?.notes ?? "", /bottom of arm/i);

// ---------------------------------------------------------------------------
// mergeMissingGenericCatalogFields — how the 11 already-seeded chassis catch up
// ---------------------------------------------------------------------------

/** A chassis seeded from the OLD preset: suspension basics only, no geometry section. */
function staleSchema(): SetupSheetModelSchema {
  return {
    version: 1,
    label: "Stale Chassis",
    structuredSections: [
      {
        id: "suspension",
        title: "Suspension (Front / Rear)",
        rows: [
          {
            type: "pair",
            label: "Camber",
            unit: "°",
            leftKey: "camber_front",
            rightKey: "camber_rear",
          },
        ],
      },
    ],
    fields: [
      {
        key: "camber_front",
        displayLabel: "Camber (Front)",
        sectionId: "suspension",
        sectionTitle: "Suspension",
        valueType: "number",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 0,
      },
      {
        key: "camber_rear",
        displayLabel: "Camber (Rear)",
        sectionId: "suspension",
        sectionTitle: "Suspension",
        valueType: "number",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 1,
      },
    ],
  };
}

const stale = staleSchema();
const merged = mergeMissingGenericCatalogFields(stale, schema);
assert.ok(merged, "a stale chassis should gain the new fields");

const mergedKeys = new Set(merged.fields.map((f) => f.key));
assert.equal(mergedKeys.has("upper_inner_shims_ff"), true, "geometry must reach a stale chassis");
assert.equal(mergedKeys.has("caster_front"), true);

// Layout must come too, or the new fields render nowhere.
const mergedGeometry = merged.structuredSections.find((s) => s.id === "geometry");
assert.ok(mergedGeometry, "the whole Link geometry section should be appended");
assert.equal(mergedGeometry.rows.some((r) => r.type === "corner4"), true);

// Strictly additive: the existing field and its layout survive untouched and stay first.
assert.equal(merged.fields[0]?.key, "camber_front");
assert.equal(merged.structuredSections[0]?.id, "suspension");
assert.equal(merged.structuredSections[0]?.rows[0]?.type, "pair");

// The already-present Camber row must not be duplicated into the suspension section.
const camberRows = merged.structuredSections
  .flatMap((s) => s.rows)
  .filter((r) => r.type === "pair" && r.leftKey === "camber_front");
assert.equal(camberRows.length, 1, "a row already on the sheet is never appended again");

// Idempotent: merging an up-to-date schema is a no-op.
assert.equal(mergeMissingGenericCatalogFields(merged, schema), null);
assert.equal(mergeMissingGenericCatalogFields(schema, schema), null);

console.log("genericPresetSchema.test.ts ok");
