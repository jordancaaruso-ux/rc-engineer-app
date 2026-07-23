/**
 * Run: npm run test:spine-routes
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTireComparisonQuery } from "@/lib/engineerPhase5/reasoningSpine/parseComparisonQuery";
import { parsePlanningQuery } from "@/lib/engineerPhase5/reasoningSpine/parsePlanningQuery";

test("parseTireComparisonQuery extracts two labels", () => {
  const q = parseTireComparisonQuery("compare vaulk vs sweep tires at tftr");
  assert.ok(q);
  assert.equal(q!.tireA.toLowerCase(), "vaulk");
  assert.equal(q!.tireB.toLowerCase(), "sweep");
  assert.equal(q!.trackQuery?.toLowerCase(), "tftr");
});

test("parseTireComparisonQuery rejects setup-only compare", () => {
  assert.equal(parseTireComparisonQuery("compare my Q run vs practice setup"), null);
});

test("parsePlanningQuery detects meeting prep", () => {
  const q = parsePlanningQuery("what should I consider for next meeting at tftr");
  assert.ok(q);
  assert.equal(q!.trackQuery?.toLowerCase(), "tftr");
  assert.equal(q!.wantsSetupConsiderations, true);
});

test("parsePlanningQuery takes the track from travel phrasing, not a trailing 'on' clause", () => {
  // Real 2/10 case: the loose "on <x>" pattern used to grab "how the previous day there went".
  const q = parsePlanningQuery(
    "I'm going to tftr in a few days - what are some things i could test based on how the previous day there went"
  );
  assert.ok(q);
  assert.equal(q!.trackQuery?.toLowerCase(), "tftr");
});

test("parsePlanningQuery returns a null track for prepositional phrases that aren't track names", () => {
  for (const msg of [
    "what should i consider based on how the previous day went",
    "going to prepare for the next race on power delivery",
    "what should i consider at the moment",
  ]) {
    const q = parsePlanningQuery(msg);
    assert.ok(q, `expected planning intent for: ${msg}`);
    assert.equal(q!.trackQuery, null, `expected null track for: ${msg}`);
  }
});
