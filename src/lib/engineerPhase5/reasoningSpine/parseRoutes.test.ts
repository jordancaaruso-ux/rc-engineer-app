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
