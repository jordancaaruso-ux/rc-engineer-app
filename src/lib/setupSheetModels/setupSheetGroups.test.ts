import assert from "node:assert/strict";
import type { StructuredRow, StructuredSection } from "@/lib/a800rrSetupDisplayConfig";
import { A800RR_STRUCTURED_SECTIONS } from "@/lib/a800rrSetupDisplayConfig";
import { GENERIC_SETUP_SHEET_V1 } from "@/lib/setupSheetTemplate";
import { UNIVERSAL_TOURING_PARAMETERS } from "@/lib/setupSheetModels/universalParameters";
import {
  groupForFieldKey,
  groupForStructuredRow,
  regroupStructuredSections,
  SETUP_SHEET_GROUPS,
  structuredRowFieldKeys,
} from "@/lib/setupSheetModels/setupSheetGroups";

// --- Every universal parameter has a display home ---
// Forcing function: adding a parameter without giving it a group fails here rather than silently
// dropping it into "Other" on every car's sheet.
for (const def of UNIVERSAL_TOURING_PARAMETERS) {
  const group = groupForFieldKey(def.id, def.label);
  assert.ok(group, `universal parameter ${def.id} has no display group`);
  assert.notEqual(group, "other", `universal parameter ${def.id} fell through to "other"`);
}

// --- Jordan's grouping: travel limits live with alignment, not with the shocks ---
for (const key of ["camber_front", "toe_rear", "caster_front", "ride_height_front", "droop_rear", "downstop_front", "upstop_rear"]) {
  assert.equal(groupForFieldKey(key), "suspension_geometry", `${key} -> suspension_geometry`);
}

// --- Moves off the printed Awesomatix layout ---
assert.equal(groupForFieldKey("diff_height_front"), "drivetrain");
assert.equal(groupForFieldKey("arb_rear"), "shocks_springs");
assert.equal(groupForFieldKey("inner_steering_angle"), "suspension_geometry");

// --- Shim stacks stay together regardless of axle/bulkhead ---
for (const key of ["upper_inner_shims_ff", "under_lower_arm_shims_rr", "upper_outer_shims_front", "under_hub_shims_rear", "bump_steer_shims_front", "toe_gain_shims_rear"]) {
  assert.equal(groupForFieldKey(key), "links_shims", `${key} -> links_shims`);
}

// --- Platform-specific keys that never became universal parameters still land correctly ---
assert.equal(groupForFieldKey("srs_arrangement_front"), "shocks_springs");
assert.equal(groupForFieldKey("pss_percent_setup_rear"), "shocks_springs");
assert.equal(groupForFieldKey("spring_gap_front"), "shocks_springs");
assert.equal(groupForFieldKey("top_deck_screws"), "chassis_flex");
assert.equal(groupForFieldKey("c45_installed_front"), "chassis_flex");
assert.equal(groupForFieldKey("weight_balance_front_percent"), "body_tyres_weight");
assert.equal(groupForFieldKey("bodyshell"), "body_tyres_weight");

// --- Aliases inherit their canonical parameter's home ---
assert.equal(groupForFieldKey("shock_oil_front"), "shocks_springs");
assert.equal(groupForFieldKey("spring_rate_rear"), "shocks_springs");
assert.equal(groupForFieldKey("ride_ht_rear"), "suspension_geometry");

// --- Heuristics catch keys a calibration or the AI drafter invented ---
assert.equal(groupForFieldKey("rear_ride_ht", "Rear ride height"), "suspension_geometry");
assert.equal(groupForFieldKey("f_shock_oil", "Front shock oil"), "shocks_springs");
assert.equal(groupForFieldKey("mugen_belt_tension", "Belt tension"), "drivetrain");
assert.equal(groupForFieldKey("xray_upper_shim_fr", "Upper shim FR"), "links_shims");

// --- Heuristic ordering: specific patterns must beat the general ones ---
// "spring gap" must not be read as a bare spring, "diff height" must not be read as a ride height.
assert.equal(groupForFieldKey("custom_spring_gap", "Spring gap"), "shocks_springs");
assert.equal(groupForFieldKey("custom_diff_height", "Diff height"), "drivetrain");
// Motor mount is flex hardware (A800 prints its screws under Flex); the motor itself is driveline.
assert.equal(groupForFieldKey("custom_motor_mount", "Motor mount"), "chassis_flex");
assert.equal(groupForFieldKey("motor", "Motor"), "drivetrain");
assert.equal(groupForFieldKey("esc", "ESC"), "drivetrain");
assert.equal(groupForFieldKey("steering_servo", "Steering servo"), "drivetrain");

// --- Session / notes fields are kept, just not given a group of their own ---
assert.equal(groupForFieldKey("driver"), "other");
assert.equal(groupForFieldKey("traction"), "other");
assert.equal(groupForFieldKey("notes"), "other");

// --- Nothing at all resolves to undefined, so callers choose the fallback ---
assert.equal(groupForFieldKey(""), undefined);
assert.equal(groupForFieldKey("zzz_unknowable", "Widget"), undefined);

// --- Row key extraction covers every StructuredRow variant ---
const pairRow: StructuredRow = { type: "pair", label: "Camber", leftKey: "camber_front", rightKey: "camber_rear" };
const corner4Row: StructuredRow = {
  type: "corner4",
  label: "Upper inner shims",
  ff: "upper_inner_shims_ff",
  fr: "upper_inner_shims_fr",
  rf: "upper_inner_shims_rf",
  rr: "upper_inner_shims_rr",
};
const slotsRow: StructuredRow = {
  type: "slots",
  label: "Custom",
  slots: [{ label: "A", key: "arb_front" }, { label: "B", key: "arb_rear" }],
};
assert.deepEqual(structuredRowFieldKeys(pairRow), ["camber_front", "camber_rear"]);
assert.equal(structuredRowFieldKeys(corner4Row).length, 4);
assert.deepEqual(structuredRowFieldKeys(slotsRow), ["arb_front", "arb_rear"]);
assert.deepEqual(structuredRowFieldKeys({ type: "top_deck_block" }), []);
assert.equal(groupForStructuredRow(corner4Row), "links_shims");
assert.equal(groupForStructuredRow(slotsRow), "shocks_springs");
// The bespoke top-deck block carries no keys but is flex hardware by definition.
assert.equal(groupForStructuredRow({ type: "top_deck_block" }), "chassis_flex");

// --- THE INVARIANT: regrouping never loses, duplicates or invents a row ---
function assertTotal(sections: StructuredSection[], what: string): void {
  const before = sections.flatMap((s) => s.rows);
  const after = regroupStructuredSections(sections).flatMap((s) => s.rows);
  assert.equal(after.length, before.length, `${what}: row count changed`);
  for (const row of before) {
    assert.equal(after.filter((r) => r === row).length, 1, `${what}: row appears != once after regroup`);
  }
}
assertTotal(A800RR_STRUCTURED_SECTIONS, "A800RR");
assertTotal(GENERIC_SETUP_SHEET_V1.structuredSections ?? [], "generic preset");

// --- An unresolvable row is parked in "Other", never dropped ---
const withMystery: StructuredSection[] = [
  { id: "x", title: "X", rows: [{ type: "single", key: "zzz_unknowable", label: "Widget" }] },
];
const regroupedMystery = regroupStructuredSections(withMystery);
assert.equal(regroupedMystery.length, 1);
assert.equal(regroupedMystery[0].id, "other");
assert.equal(regroupedMystery[0].rows.length, 1);

// --- Output follows the fixed group order, and empty groups are omitted ---
const regroupedA800 = regroupStructuredSections(A800RR_STRUCTURED_SECTIONS);
const order = SETUP_SHEET_GROUPS.map((g) => g.id);
const seen = regroupedA800.map((s) => s.id);
assert.deepEqual(seen, order.filter((id) => seen.includes(id)), "groups must follow SETUP_SHEET_GROUPS order");
assert.ok(seen.length > 0 && regroupedA800.every((s) => s.rows.length > 0), "no empty groups emitted");
// Tyres last is deliberate — the order is location-on-car, not a tuning order.
assert.equal(order[order.length - 2], "body_tyres_weight");
assert.equal(order[order.length - 1], "other");

// --- A real sheet actually consolidates: the A800's 6 printed sections collapse into the groups ---
assert.ok(seen.includes("suspension_geometry") && seen.includes("shocks_springs") && seen.includes("links_shims"));
assert.ok(seen.includes("drivetrain") && seen.includes("chassis_flex") && seen.includes("body_tyres_weight"));

console.log("setupSheetGroups.test.ts ok");
