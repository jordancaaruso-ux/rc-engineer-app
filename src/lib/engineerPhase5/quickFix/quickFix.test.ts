/**
 * Run: `npx tsx src/lib/engineerPhase5/quickFix/quickFix.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHandlingAssessmentJson } from "@/lib/runHandlingAssessment";
import {
  communityBoldnessHint,
  inferPrimaryHandlingIssue,
  magnitudeTierFromCarRating,
  magnitudeTierLabel,
} from "@/lib/engineerPhase5/quickFix/quickFixMagnitude";
import { parseQuickFixLlmShape } from "@/lib/engineerPhase5/quickFix/parseQuickFixLlmShape";
import { evaluateQuickFixAccess } from "@/lib/engineerPhase5/quickFix/quickFixAccess";

test("magnitudeTierFromCarRating maps 1-10 bands", () => {
  assert.equal(magnitudeTierFromCarRating(1), "big");
  assert.equal(magnitudeTierFromCarRating(3), "big");
  assert.equal(magnitudeTierFromCarRating(4), "moderate");
  assert.equal(magnitudeTierFromCarRating(6), "moderate");
  assert.equal(magnitudeTierFromCarRating(7), "fine");
  assert.equal(magnitudeTierFromCarRating(9), "fine");
  assert.equal(magnitudeTierFromCarRating(10), "minimal");
  assert.equal(magnitudeTierFromCarRating(null), "moderate");
});

test("magnitudeTierLabel matches spec wording", () => {
  assert.match(magnitudeTierLabel("big"), /big moves/);
  assert.match(magnitudeTierLabel("minimal"), /celebrate/);
});

test("inferPrimaryHandlingIssue reads strongest phase balance", () => {
  const parsed = parseHandlingAssessmentJson({
    version: 5,
    balanceByPhase: { entry: -1, mid: -3, exit: 1 },
  });
  assert.equal(inferPrimaryHandlingIssue(parsed), "strong understeer in mid");
});

test("communityBoldnessHint reacts to spread extremes", () => {
  const many = communityBoldnessHint([
    { positionBand: "below_typical" },
    { positionBand: "above_typical" },
    { positionBand: "above_typical" },
    { positionBand: "below_typical" },
  ]);
  assert.match(many, /smaller reversible/);
  const none = communityBoldnessHint([{ positionBand: "mid" }]);
  assert.match(none, /near community medians/);
});

test("parseQuickFixLlmShape validates suggestion fields", () => {
  const rows = parseQuickFixLlmShape({
    suggestions: [
      {
        parameter: "Front ARB",
        direction: "Soften one step",
        amount: "One softer insert",
        kbWhy: "More mechanical grip at the front reduces push on entry.",
        confidence: "high",
        expectedEffect: "Should help mid-corner push.",
        priority: 2,
      },
      { parameter: "", direction: "x", kbWhy: "y" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parameter, "Front ARB");
  assert.equal(rows[0].confidence, "high");
  assert.equal(rows[0].priority, 2);
});

test("evaluateQuickFixAccess mirrors engineer run visibility", () => {
  assert.equal(
    evaluateQuickFixAccess({
      viewerId: "u1",
      runUserId: "u1",
      shareWithTeam: false,
      canViewPeer: false,
      teamOnly: false,
    }),
    true
  );
  assert.equal(
    evaluateQuickFixAccess({
      viewerId: "u1",
      runUserId: "u2",
      shareWithTeam: null,
      canViewPeer: true,
      teamOnly: true,
    }),
    true
  );
  assert.equal(
    evaluateQuickFixAccess({
      viewerId: "u1",
      runUserId: "u2",
      shareWithTeam: false,
      canViewPeer: true,
      teamOnly: true,
    }),
    false
  );
  assert.equal(
    evaluateQuickFixAccess({
      viewerId: "u1",
      runUserId: "u2",
      shareWithTeam: true,
      canViewPeer: false,
      teamOnly: false,
    }),
    false
  );
});
