import assert from "node:assert/strict";
import test from "node:test";
import { liveRcNameMatchesConfigured } from "./liveRcNameNormalize";

test("exact match (normalized) still matches", () => {
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy", "Tim Boundy"), true);
  assert.equal(liveRcNameMatchesConfigured("tim boundy", "TIM BOUNDY"), true);
  assert.equal(liveRcNameMatchesConfigured("Tim  Boundy", "Tim Boundy"), true); // whitespace collapse
});

test("club-appended noise on the listed name matches (the Tim Boundy M case)", () => {
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy M", "Tim Boundy"), true); // member tag
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy 1", "Tim Boundy"), true); // number
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy (Jnr)", "Tim Boundy"), true); // punctuation stripped
});

test("a single-char tag is ignored on either side (so a 'Tim Boundy M' setting still matches too)", () => {
  // "M" is <2 chars so it's dropped from the token list — the match is symmetric for 1-char tags.
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy", "Tim Boundy M"), true);
});

test("a ≥2-char extra word in the configured name is required in the listing (subset direction)", () => {
  // Users set their plain name, so this asymmetry is the safe direction; documented, not a bug.
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy", "Tim Boundy Jnr"), false);
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy Jnr", "Tim Boundy"), true);
});

test("≥2-word safety rail — a bare single token can't sweep the field", () => {
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy", "Boundy"), false);
  assert.equal(liveRcNameMatchesConfigured("Bob Boundy", "Boundy"), false);
});

test("different driver who merely shares a surname does not match", () => {
  assert.equal(liveRcNameMatchesConfigured("Jane Boundy", "Tim Boundy"), false);
  assert.equal(liveRcNameMatchesConfigured("Tim Anderson", "Tim Boundy"), false);
});

test("empty / missing names never match", () => {
  assert.equal(liveRcNameMatchesConfigured("", "Tim Boundy"), false);
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy M", ""), false);
});

test("both words required — one present, one absent => no match", () => {
  assert.equal(liveRcNameMatchesConfigured("Tim Anderson M", "Tim Boundy"), false);
});
