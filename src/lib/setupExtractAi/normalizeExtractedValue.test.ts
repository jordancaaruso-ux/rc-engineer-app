import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractedValuesMatch,
  matchesExpected,
  normalizeExtractedValue,
} from "@/lib/setupExtractAi/normalizeExtractedValue";

test("strips unit suffixes and lowercases", () => {
  assert.equal(normalizeExtractedValue("5.8 /mm"), "5.8");
  assert.equal(normalizeExtractedValue("375 cSt"), "375");
  assert.equal(normalizeExtractedValue("18°C"), "18");
  assert.equal(normalizeExtractedValue("1.8 /degr"), "1.8");
  assert.equal(normalizeExtractedValue("11.7 /sec"), "11.7");
  assert.equal(normalizeExtractedValue("50 %"), "50");
  assert.equal(normalizeExtractedValue("Twister UL"), "twister ul");
});

test("keeps slashes in dates and ranges intact", () => {
  assert.equal(normalizeExtractedValue("27/03/2022"), "27/03/2022");
  assert.equal(normalizeExtractedValue("2.5-2.8"), "2.5-2.8");
});

test("decimal comma reads as dot for plain numbers", () => {
  assert.equal(normalizeExtractedValue("2,5"), "2.5");
  assert.equal(normalizeExtractedValue("1,5 /mm"), "1.5");
});

test("numeric equivalence matches across formatting", () => {
  assert.equal(extractedValuesMatch("5.0", "5"), true);
  assert.equal(extractedValuesMatch("19 /mm", "19"), true);
  assert.equal(extractedValuesMatch("10k", "10000"), false);
  assert.equal(extractedValuesMatch("2.5", "2.7"), false);
});

test("empty only matches empty", () => {
  assert.equal(extractedValuesMatch("", ""), true);
  assert.equal(extractedValuesMatch("", "0"), false);
  assert.equal(extractedValuesMatch("0", ""), false);
});

test("matchesExpected honors accept alternates", () => {
  assert.equal(matchesExpected({ extracted: "10k", expected: "10000", accept: ["10k"] }), true);
  assert.equal(matchesExpected({ extracted: "hobbywing 5.0t", expected: "Hobbywing 5.0T" }), true);
  assert.equal(matchesExpected({ extracted: "5.5t", expected: "Hobbywing 5.0T" }), false);
});
