import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLiveRcDriverNamesForDisplay,
  formatLiveRcDriverNamesForSetting,
  liveRcNameMatchesConfigured,
  liveRcPracticeRowIsMine,
  liveRcPracticeRowTransponder,
  normalizeLiveRcDriverNameForMatch,
  parseLiveRcDriverNamesSetting,
} from "./liveRcNameNormalize";

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

test("several configured names, one per line — any of them matches", () => {
  const names = "Jordan Caruso\nJC Racing";
  assert.equal(liveRcNameMatchesConfigured("Jordan Caruso M", names), true);
  assert.equal(liveRcNameMatchesConfigured("JC Racing", names), true);
  assert.equal(liveRcNameMatchesConfigured("Tim Boundy", names), false);
  // The two names never fuse into one four-word name.
  assert.equal(liveRcNameMatchesConfigured("Jordan Caruso JC Racing", names), true);
  assert.equal(liveRcNameMatchesConfigured("Jordan Racing", names), false);
});

test("names survive being normalized before they reach the matcher (most callers do this)", () => {
  const norm = normalizeLiveRcDriverNameForMatch("Jordan Caruso\r\n  JC Racing \n");
  assert.equal(norm, "jordan caruso\njc racing");
  assert.equal(normalizeLiveRcDriverNameForMatch(norm), norm);
  assert.equal(liveRcNameMatchesConfigured("JC Racing", norm), true);
  assert.equal(normalizeLiveRcDriverNameForMatch("Tim  Boundy."), "tim boundy");
});

test("a one-word nickname matches only a listing that is exactly that word", () => {
  assert.equal(liveRcNameMatchesConfigured("Jordy", "Jordan Caruso\nJordy"), true);
  assert.equal(liveRcNameMatchesConfigured("Jordy Smith", "Jordan Caruso\nJordy"), false);
});

test("the setting parses to a list, deduped, and round-trips", () => {
  assert.deepEqual(parseLiveRcDriverNamesSetting("Jordan Caruso"), ["Jordan Caruso"]);
  assert.deepEqual(parseLiveRcDriverNamesSetting("Jordan Caruso\njordan  caruso\n\nJC Racing"), [
    "Jordan Caruso",
    "JC Racing",
  ]);
  assert.deepEqual(parseLiveRcDriverNamesSetting(null), []);
  assert.equal(formatLiveRcDriverNamesForSetting(["Jordan Caruso", " JC Racing "]), "Jordan Caruso\nJC Racing");
  assert.equal(formatLiveRcDriverNamesForDisplay("Jordan Caruso\nJC Racing"), "Jordan Caruso / JC Racing");
});

test("practice row: the chip LiveRC prints is read off the trailing bracket", () => {
  assert.equal(liveRcPracticeRowTransponder("Cooper DavisModified (4344915)"), 4344915);
  assert.equal(liveRcPracticeRowTransponder("Cooper Davis Modified"), null);
  assert.equal(liveRcPracticeRowTransponder("Tim Boundy (Jnr)"), null);
});

test("practice row: a saved chip is the driver's run whatever the name says", () => {
  assert.equal(liveRcPracticeRowIsMine("Some NicknameModified (4344915)", "Jordan Caruso", [4344915]), true);
  // No name saved at all — the chip alone is enough.
  assert.equal(liveRcPracticeRowIsMine("Some NicknameModified (4344915)", "", [4344915]), true);
});

test("practice row: someone else's chip still falls back to the name (borrowed or new chip)", () => {
  assert.equal(liveRcPracticeRowIsMine("Jordan CarusoModified (9999999)", "Jordan Caruso", [4344915]), true);
  assert.equal(liveRcPracticeRowIsMine("Tim BoundyModified (9999999)", "Jordan Caruso", [4344915]), false);
  assert.equal(liveRcPracticeRowIsMine("Tim BoundyModified", "", []), false);
});
