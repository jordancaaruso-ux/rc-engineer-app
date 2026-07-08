/**
 * v6 handling model — new traits (on-power, braking), speed tags, feelGeneral retirement,
 * and legacy migration. Run: `npx tsx src/lib/runHandlingAssessmentV6.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyHandlingAssessmentUiState,
  formatHandlingAssessmentForEngineer,
  parseHandlingAssessmentJson,
  persistedFromUiState,
  uiStateFromParsed,
  type HandlingAssessmentUiState,
} from "@/lib/runHandlingAssessment";

test("parses v6 on-power + braking traits and normalizes to version 6", () => {
  const parsed = parseHandlingAssessmentJson({ version: 6, onPower: -2, braking: -1 });
  assert.ok(parsed);
  assert.equal(parsed.version, 6);
  assert.equal(parsed.onPower, -2);
  assert.equal(parsed.braking, -1);
});

test("legacy v5 row migrates forward: keeps feelGeneral, becomes version 6, no on-power", () => {
  const parsed = parseHandlingAssessmentJson({ version: 5, feelSteering: 2, feelGeneral: -1, driveEase: -2 });
  assert.ok(parsed);
  assert.equal(parsed.version, 6);
  assert.equal(parsed.feelSteering, 2);
  assert.equal(parsed.feelGeneral, -1);
  assert.equal(parsed.driveEase, -2);
  assert.equal(parsed.onPower, undefined);
});

test("speed tags parse only for set issues and orphans are pruned", () => {
  const parsed = parseHandlingAssessmentJson({
    version: 6,
    balanceByPhase: { mid: -2 },
    onPower: -2,
    speedTags: {
      "balance:mid": "slow",
      "trait:onPower": "fast",
      "trait:braking": "both", // orphan — braking not set
      "balance:entry": "slow", // orphan — entry not set
    },
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.speedTags, { "balance:mid": "slow", "trait:onPower": "fast" });
});

test("invalid speed value is dropped", () => {
  const parsed = parseHandlingAssessmentJson({
    version: 6,
    onPower: -1,
    speedTags: { "trait:onPower": "medium" },
  });
  assert.ok(parsed);
  assert.equal(parsed.speedTags, undefined);
});

test("UI state round-trips on-power, braking, and a speed tag", () => {
  const ui: HandlingAssessmentUiState = {
    ...emptyHandlingAssessmentUiState(),
    balanceMid: -2,
    onPower: -3,
    braking: -1,
    speedTags: { "balance:mid": "slow", "trait:onPower": "both" },
  };
  const persisted = persistedFromUiState(ui);
  assert.ok(persisted);
  assert.equal(persisted.onPower, -3);
  assert.equal(persisted.braking, -1);
  assert.deepEqual(persisted.speedTags, { "balance:mid": "slow", "trait:onPower": "both" });

  const back = uiStateFromParsed(persisted);
  assert.equal(back.onPower, -3);
  assert.equal(back.braking, -1);
  assert.deepEqual(back.speedTags, { "balance:mid": "slow", "trait:onPower": "both" });
});

test("engineer text surfaces flagged trait with its speed context", () => {
  const text = formatHandlingAssessmentForEngineer({
    version: 6,
    onPower: -2,
    speedTags: { "trait:onPower": "slow" },
  });
  assert.match(text, /On-power/);
  assert.match(text, /slow corners/);
});

test("clearing the underlying trait drops its speed tag on re-sanitize", () => {
  const persisted = persistedFromUiState({
    ...emptyHandlingAssessmentUiState(),
    onPower: null,
    speedTags: { "trait:onPower": "fast" },
  });
  // No on-power set → the whole assessment is empty → null.
  assert.equal(persisted, null);
});
