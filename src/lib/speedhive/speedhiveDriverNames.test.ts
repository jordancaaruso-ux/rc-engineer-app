/**
 * Run: `npx tsx --test src/lib/speedhive/speedhiveDriverNames.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSpeedhiveDriverNamesForSetting,
  normalizeSpeedhiveDriverNamesForMatch,
  parseSpeedhiveDriverNamesSetting,
} from "@/lib/speedhive/speedhiveDriverNames";
import { speedhiveDriverNameMatchesAny } from "@/lib/speedhive/speedhiveNameNormalize";

test("a single stored name still parses — nothing saved before this needs migrating", () => {
  assert.deepEqual(parseSpeedhiveDriverNamesSetting("Jordan Caruso"), ["Jordan Caruso"]);
  assert.deepEqual(parseSpeedhiveDriverNamesSetting(null), []);
  assert.deepEqual(parseSpeedhiveDriverNamesSetting("   "), []);
});

test("one name per line", () => {
  assert.deepEqual(parseSpeedhiveDriverNamesSetting("Jordan Caruso\nJ Caruso\r\nJordy C"), [
    "Jordan Caruso",
    "J Caruso",
    "Jordy C",
  ]);
});

test("commas are NOT separators — timing sheets print surname first", () => {
  // Splitting here would leave "Caruso" and "Jordan", two single-token fragments
  // that can only match on exact equality. One name is strictly better.
  assert.deepEqual(parseSpeedhiveDriverNamesSetting("Caruso, Jordan"), ["Caruso, Jordan"]);
  assert.equal(
    speedhiveDriverNameMatchesAny(
      "Jordan Caruso",
      normalizeSpeedhiveDriverNamesForMatch(parseSpeedhiveDriverNamesSetting("Caruso, Jordan"))
    ),
    true,
    "surname-first still matches the printed row"
  );
});

test("duplicates collapse on the normalized form, keeping the typed spelling", () => {
  assert.deepEqual(parseSpeedhiveDriverNamesSetting("Jordan Caruso\njordan  caruso\nJORDAN CARUSO"), [
    "Jordan Caruso",
  ]);
});

test("a JSON array is accepted too", () => {
  assert.deepEqual(parseSpeedhiveDriverNamesSetting('["Jordan Caruso","J Caruso"]'), [
    "Jordan Caruso",
    "J Caruso",
  ]);
});

test("format round-trips through parse", () => {
  const names = ["Jordan Caruso", "J Caruso", "Caruso, Jordan"];
  assert.deepEqual(parseSpeedhiveDriverNamesSetting(formatSpeedhiveDriverNamesForSetting(names)), names);
});

test("normalizing drops blanks and dedupes", () => {
  assert.deepEqual(normalizeSpeedhiveDriverNamesForMatch(["Jordan Caruso", "  ", "jordan caruso"]), [
    "jordan caruso",
  ]);
  assert.deepEqual(normalizeSpeedhiveDriverNamesForMatch([]), []);
});

test("any spelling matching is a match", () => {
  const norms = normalizeSpeedhiveDriverNamesForMatch(["Jordan Caruso", "J Caruso"]);
  assert.equal(speedhiveDriverNameMatchesAny("J Caruso", norms), true);
  assert.equal(speedhiveDriverNameMatchesAny("Jordan Caruso", norms), true);
  assert.equal(speedhiveDriverNameMatchesAny("Someone Else", norms), false);
  assert.equal(speedhiveDriverNameMatchesAny("Jordan Caruso", []), false);
});
