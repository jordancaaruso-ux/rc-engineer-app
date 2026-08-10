import assert from "node:assert/strict";
import {
  canonicalAggregationParameterKey,
  isUniversalTouringTuningParameter,
  resolveUniversalParameterId,
  universalParameterIdsBySchemaKey,
} from "@/lib/setupSheetModels/universalParameters";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";

// --- Aliases still fold onto their canonical id ---
assert.equal(canonicalAggregationParameterKey("spring_rate_front"), "spring_front");
assert.equal(canonicalAggregationParameterKey("ride_ht_rear"), "ride_height_rear");
assert.equal(canonicalAggregationParameterKey("toe_rear"), "toe_rear");
assert.equal(canonicalAggregationParameterKey("custom_mugen_arb"), "custom_mugen_arb");

// --- Damper oil is canonical; the old generic-preset spelling is the alias (2026-07-25) ---
assert.equal(canonicalAggregationParameterKey("shock_oil_front"), "damper_oil_front");
assert.equal(canonicalAggregationParameterKey("damper_oil_front"), "damper_oil_front");
assert.equal(isUniversalTouringTuningParameter("shock_oil_rear"), true);

// --- Droop and downstop are SEPARATE parameters, not aliases (2026-07-25) ---
// They measure different things (ground->wheel ~21-24 mm vs ground->bottom of arm ~4-7 mm), so
// pooling them would average incompatible numbers into a median describing no real car.
assert.equal(canonicalAggregationParameterKey("droop_front"), "droop_front");
assert.equal(canonicalAggregationParameterKey("downstop_front"), "downstop_front");
assert.notEqual(
  canonicalAggregationParameterKey("downstop_rear"),
  canonicalAggregationParameterKey("droop_rear")
);
assert.equal(isUniversalTouringTuningParameter("downstop_rear"), true);
assert.equal(isUniversalTouringTuningParameter("droop_rear"), true);

// --- Link geometry pools across cars, so a second chassis can't mint a near-duplicate ---
for (const key of [
  "upper_inner_shims_ff",
  "upper_inner_shims_rr",
  "under_lower_arm_shims_fr",
  "upper_outer_shims_front",
  "under_hub_shims_rear",
  "bump_steer_shims_front",
  "toe_gain_shims_rear",
  "caster_front",
  "diff_oil",
]) {
  assert.equal(isUniversalTouringTuningParameter(key), true, `${key} should be universal`);
}

// --- Retired: the manual roll-centre entry (the Engineer uses derived_roll_center_*_mm) ---
assert.equal(isUniversalTouringTuningParameter("roll_center_front"), false);

// --- Non-parameters stay out ---
assert.equal(isUniversalTouringTuningParameter("driver"), false);

// --- Heuristic matcher agrees with the registry ---
assert.equal(suggestUniversalParameterId("rear_downstop", "Rear downstop"), "downstop_rear");
assert.equal(suggestUniversalParameterId("front_droop", "Front droop"), "droop_front");
assert.equal(suggestUniversalParameterId("f_castor", "Front castor"), "caster_front");
assert.equal(suggestUniversalParameterId("shock_oil_f", "Shock oil front"), "damper_oil_front");
// Axle-less concept resolves without a side.
assert.equal(suggestUniversalParameterId("diff_oil_cst", "Diff oil"), "diff_oil");
// Roll centre no longer maps anywhere — it must not return a dangling id.
assert.equal(suggestUniversalParameterId("roll_centre_front", "Roll centre front"), undefined);
// Ambiguous axle is never guessed.
assert.equal(suggestUniversalParameterId("camber_thing", "Camber"), undefined);

// --- A sheet can declare what its own keys mean (2026-08-10) ---
// The case this exists for: a sheet derived from a manufacturer's PDF is keyed off that PDF's form
// field names, so nothing about the key string says "droop". Before this, such a sheet contributed
// to no cross-car pool at all no matter what it declared.
const pdfDerived = universalParameterIdsBySchemaKey({
  fields: [
    { key: "text47", universalParameterId: "damper_oil_front" },
    { key: "fr_droop", universalParameterId: "droop_front" },
    { key: "text12", universalParameterId: "  " }, // declared nothing
    { key: "", universalParameterId: "toe_front" }, // no key to attach to
    { key: "text99", universalParameterId: "not_a_real_parameter" },
    "junk",
  ],
});
assert.equal(pdfDerived.size, 3);
assert.equal(resolveUniversalParameterId("text47", pdfDerived), "damper_oil_front");
assert.equal(resolveUniversalParameterId("fr_droop", pdfDerived), "droop_front");

// A declaration that isn't a real canonical id is ignored, not trusted — a driver naming a box
// must never be able to mint a new shared pool.
assert.equal(resolveUniversalParameterId("text99", pdfDerived), undefined);

// Keys the schema says nothing about still resolve through the alias table, so behaviour is
// unchanged for the existing catalog and for the derived geometry metrics (which have no field).
assert.equal(resolveUniversalParameterId("text12", pdfDerived), undefined);
assert.equal(resolveUniversalParameterId("shock_oil_front", pdfDerived), "damper_oil_front");
assert.equal(resolveUniversalParameterId("spring_rate_rear", null), "spring_rear");
assert.equal(resolveUniversalParameterId("driver", null), undefined);

// Declared ids fold through the alias table too, so an older spelling still lands canonically.
const legacySpelling = universalParameterIdsBySchemaKey({
  fields: [{ key: "box_3", universalParameterId: "shock_oil_rear" }],
});
assert.equal(resolveUniversalParameterId("box_3", legacySpelling), "damper_oil_rear");

// Whatever the sheet says, a key that already reads as a universal parameter keeps working.
assert.equal(resolveUniversalParameterId("camber_front", new Map()), "camber_front");

// Malformed schemas are not a crash.
for (const bad of [null, undefined, {}, { fields: null }, { fields: "nope" }]) {
  assert.equal(universalParameterIdsBySchemaKey(bad as { fields?: unknown }).size, 0);
}

console.log("universalParameters.test.ts ok");
