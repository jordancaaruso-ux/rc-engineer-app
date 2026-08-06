import assert from "node:assert/strict";
import {
  buildStaticLabelCorpus,
  corpusMatchTokens,
  isPositionalToken,
} from "@/lib/chassisOnboarding/labelCorpus";
import {
  demoteCollidingMatches,
  matchAllFields,
  matchFieldToCorpus,
  type FieldMatch,
} from "@/lib/chassisOnboarding/matchFields";
import { isUnitCaption } from "@/lib/chassisOnboarding/printedText";

const corpus = buildStaticLabelCorpus();
assert.ok(corpus.length > 100, "static corpus should carry the shipped vocabulary");

const match = (acroName: string, printedLabel?: string): FieldMatch =>
  matchFieldToCorpus(
    { key: acroName.toLowerCase().replace(/[^a-z0-9]+/g, "_"), acroName, printedLabel },
    corpus
  );

// --- Xray's own field names resolve through the registry, carrying a universal id ---
for (const [name, expected] of [
  ["fr-shock-oil", "damper_oil_front"],
  ["re-shock-oil", "damper_oil_rear"],
  ["fr-camber", "camber_front"],
  ["re-ride-height", "ride_height_rear"],
  ["fr-toe-out", "toe_front"],
  ["re-downstop", "downstop_rear"],
] as const) {
  const m = match(name);
  assert.equal(m.tier, "auto", `${name} should auto-match`);
  assert.equal(m.entry?.universalParameterId, expected, `${name} → ${expected}`);
}

// --- Agreement on a side alone is not a match ---
// Every `fr-*` field once matched "Toe (Front)" at 0.5 because they share "front"; a suggestion
// list where rebound, pistons and body posts all read as toe is a list nobody trusts.
for (const name of ["fr-rebound", "fr-pistons", "fr-bodypost", "fr-brace", "re-dia"]) {
  const m = match(name);
  assert.equal(m.tier, "residue", `${name} shares only an axle word and must not match`);
}
assert.equal(isPositionalToken("front"), true);
assert.equal(isPositionalToken("camber"), false);

// --- `fr`/`rr` stay literal: they mean FRONT on an Xray sheet but the front bulkhead's REAR
// pickup in the app's own link keys, so expanding them would eventually cross axles ---
assert.deepEqual(corpusMatchTokens("upper_inner_shims_fr"), ["upper", "inner", "shims", "fr"]);
assert.ok(!corpusMatchTokens("fr-shims").includes("front"));

// --- Acrobat's default names carry nothing and must be reported as such, not weakly matched ---
for (const name of ["Text47", "Text2112", "Check Box11", "CheckBox8"]) {
  const m = match(name);
  assert.equal(m.tier, "residue", `${name} is an Acrobat default`);
  assert.equal(m.reason, "opaque_name", `${name} should be flagged opaque, not scored`);
}

// --- A printed caption rescues a sheet whose field names say nothing ---
const captioned = match("Text47", "CAMBER");
assert.notEqual(captioned.reason, "opaque_name", "a caption gives an opaque field something to match");
assert.ok(captioned.entry?.displayLabel.toLowerCase().includes("camber"));
// ...but the caption alone never picks a side, because the sheet prints "CAMBER" over both axles.
assert.equal(captioned.tier, "suggested", "an unsided caption must be confirmed, never auto-applied");

// --- Two boxes cannot be one parameter ---
// Live case: X4'26 has both `re-caster` and `re-uppr-links-caster`. Auto-applying both means one
// silently overwrites the other and the sheet quietly loses a parameter.
const collided = matchAllFields(
  [
    { key: "re_caster", acroName: "re-caster" },
    { key: "re_uppr_links_caster", acroName: "re-uppr-links-caster" },
    { key: "fr_camber", acroName: "fr-camber" },
  ],
  corpus
);
assert.equal(collided.get("re_caster")!.tier, "suggested");
assert.equal(collided.get("re_uppr_links_caster")!.tier, "suggested");
assert.equal(collided.get("fr_camber")!.tier, "auto", "an uncontested field still auto-applies");

// Demotion is idempotent and leaves a single claimant alone.
const single = new Map<string, FieldMatch>([["fr_camber", collided.get("fr_camber")!]]);
demoteCollidingMatches(single);
assert.equal(single.get("fr_camber")!.tier, "auto");

// --- Printed units are units, not names ---
// Without this, the nearest caption to half the Awesomatix boxes is "MM", which names them all
// identically and none of them usefully.
for (const unit of ["mm", "MM", "/Cst", "°", "%", "gf"]) {
  assert.equal(isUnitCaption(unit), true, `${unit} is a unit`);
}
for (const label of ["CAMBER", "TRACK SURFACE", "MEDIUM", "GEAR DIFF OIL"]) {
  assert.equal(isUnitCaption(label), false, `${label} is a name`);
}

console.log("chassisOnboarding/matchFields: all assertions passed");
