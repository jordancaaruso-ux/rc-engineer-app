/**
 * Run: `npx tsx src/lib/engineerPhase5/betweenRunHints/pairwiseSetupDigestForHints.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPairwiseSetupDigestForHints } from "@/lib/engineerPhase5/betweenRunHints/pairwiseSetupDigestForHints";
import {
  filterAvoidRepeatingForBetweenRunHints,
  pseudoSetupChangesFromSessionLines,
} from "@/lib/engineerPhase5/betweenRunHints/avoidRepeatingFilterForHints";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

function row(
  label: string,
  before: string,
  after: string,
  key: string
): EngineerRunSummaryV2["setupChanges"][number] {
  return { key, label, before, after, rankReason: "", severity: "medium" };
}

test("pairwise digest lists both damper lines", () => {
  const summary = {
    setupChanges: [
      row("Front damper (%)", "60", "80", "f"),
      row("Rear damper (%)", "60", "80", "r"),
    ],
  } as EngineerRunSummaryV2;
  const d = buildPairwiseSetupDigestForHints(summary);
  assert.ok(d?.includes("Front damper"));
  assert.ok(d?.includes("Rear damper"));
  assert.ok(d?.includes("60"));
  assert.ok(d?.includes("80"));
});

test("filter drops Do not repeat template", () => {
  const setupChanges = [row("Front damper (%)", "60", "80", "f")];
  const out = filterAvoidRepeatingForBetweenRunHints({
    text: "Do not repeat the front damper % increase until verified.",
    setupChanges,
    headline: "Test",
    bullets: ["a", "b"],
  });
  assert.equal(out, null);
});

test("filter drops Avoid stacking template", () => {
  const setupChanges = [row("Spring", "4", "5", "k")];
  const out = filterAvoidRepeatingForBetweenRunHints({
    text: "Avoid stacking more changes in the same direction until you confirm pace.",
    setupChanges,
    headline: "H",
    bullets: ["b1", "b2"],
  });
  assert.equal(out, null);
});

test("pseudo rows from session lines carry labels for filter", () => {
  const lines = ["Front damper (%): 60 → 80", "Rear damper (%): 60 → 80"];
  const pseudo = pseudoSetupChangesFromSessionLines(lines);
  assert.equal(pseudo.length, 2);
  const kept = filterAvoidRepeatingForBetweenRunHints({
    text: "Before adding more rebound, re-check rear damper % vs your last happy sheet.",
    setupChanges: pseudo,
    headline: "H",
    bullets: ["b1", "b2"],
  });
  assert.ok(kept && kept.length > 10);
});
