import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalGeometrySignedValue,
  isGeometrySignCanonicalKey,
  unsignedGeometryValueForPaper,
} from "@/lib/setup/geometrySignNormalize";

// --- Storage: one convention, whatever the driver typed ---
test("a ruled angle is stored with the app's sign, not the one it arrived with", () => {
  assert.equal(canonicalGeometrySignedValue("camber_front", "1.75"), -1.75);
  assert.equal(canonicalGeometrySignedValue("camber_front", "-1.75"), -1.75);
  assert.equal(canonicalGeometrySignedValue("toe_rear", "-2.5"), 2.5);
  assert.equal(canonicalGeometrySignedValue("caster_rear", "3"), -3);
  // An unruled key, or something that isn't a number, is left entirely alone.
  assert.equal(canonicalGeometrySignedValue("spring_front", "1.75"), undefined);
  assert.equal(canonicalGeometrySignedValue("camber_front", "soft"), undefined);
});

/*
 * ============================ PAPER: NO SHEET PRINTS A MINUS SIGN ============================
 *
 * Simon Lauter's A800RR sheet prints front camber 1.75 and front toe 1.25. Uploading it stored
 * −1.75 / −1.25 (correct — one convention across every car), and downloading it printed those back
 * onto a sheet that has never in its life printed a minus sign. Founder call 2026-08-14: the paper
 * gets the magnitude.
 */
test("the six ruled angles print unsigned, the way the manufacturer's sheet does", () => {
  assert.equal(unsignedGeometryValueForPaper("camber_front", "-1.75"), "1.75");
  assert.equal(unsignedGeometryValueForPaper("toe_front", "-1.25"), "1.25");
  assert.equal(unsignedGeometryValueForPaper("caster_rear", "-3"), "3");
  // A minus typed as a real dash rather than a hyphen is still a minus.
  assert.equal(unsignedGeometryValueForPaper("camber_rear", "−2.0"), "2.0");
  // Already unsigned, so nothing to do — including the ones the app signs positive.
  assert.equal(unsignedGeometryValueForPaper("toe_rear", "2.5"), "2.5");
  assert.equal(unsignedGeometryValueForPaper("camber_front", "1.75"), "1.75");
});

test("only the ruled keys are touched, and only when the rest is a number", () => {
  // A negative the app never imposed keeps its sign — the rule is about undoing the app's own.
  assert.equal(unsignedGeometryValueForPaper("ride_height_front", "-1.5"), "-1.5");
  assert.equal(unsignedGeometryValueForPaper("spring_front", "-2"), "-2");
  // "-" alone, or a word, would otherwise silently lose its first character.
  assert.equal(unsignedGeometryValueForPaper("camber_front", "-"), "-");
  assert.equal(unsignedGeometryValueForPaper("camber_front", "-see notes"), "-see notes");
  assert.equal(unsignedGeometryValueForPaper("camber_front", ""), "");
});

test("the ruled set is exactly the six geometry angles", () => {
  for (const k of ["camber_front", "camber_rear", "toe_front", "toe_rear", "caster_front", "caster_rear"]) {
    assert.equal(isGeometrySignCanonicalKey(k), true, k);
  }
  assert.equal(isGeometrySignCanonicalKey("ride_height_front"), false);
});
