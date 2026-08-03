/**
 * Run: `npx tsx --test src/lib/setup/setupFillDraft.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampDraftCount,
  clampDraftText,
  clampStepIndex,
  parseSetupFillDraftSubject,
  resumePendingText,
  setupFillDraftProgressLabel,
} from "@/lib/setup/setupFillDraft";
import type { SetupFillStep } from "@/lib/setup/setupFillOrder";

function step(key: string): SetupFillStep {
  return {
    key,
    label: key,
    sectionId: "s",
    sectionTitle: "S",
    kind: "number",
    indexInSection: 1,
    sectionSize: 1,
  };
}

test("a stored step index is clamped into today's step list", () => {
  assert.equal(clampStepIndex(3, 68), 3);
  assert.equal(clampStepIndex(-1, 68), 0);
  assert.equal(clampStepIndex(0, 68), 0);
  // stepCount is one past the last question: the review screen, and the right place to land
  // when the sheet shrank out from under a saved index.
  assert.equal(clampStepIndex(68, 68), 68);
  assert.equal(clampStepIndex(999, 68), 68);
  assert.equal(clampStepIndex(5, 0), 0);
});

test("a non-numeric step index falls back to the first question", () => {
  assert.equal(clampStepIndex(undefined, 68), 0);
  assert.equal(clampStepIndex(null, 68), 0);
  assert.equal(clampStepIndex(Number.NaN, 68), 0);
  assert.equal(clampStepIndex("4", 68), 0);
  assert.equal(clampStepIndex(4.7, 68), 4);
});

test("half-typed text comes back only on the question it was typed into", () => {
  assert.equal(resumePendingText({ text: "2.7-blue", stepKey: "spring_f" }, step("spring_f")), "2.7-blue");
  // The schema gained a parameter, so the saved index now points somewhere else. Pasting the
  // text into the wrong question is worse than dropping it.
  assert.equal(resumePendingText({ text: "2.7-blue", stepKey: "spring_f" }, step("rh_f")), null);
  assert.equal(resumePendingText({ text: "2.7-blue", stepKey: null }, step("spring_f")), null);
  assert.equal(resumePendingText({ text: null, stepKey: "spring_f" }, step("spring_f")), null);
  // Index landed on the review screen — there is no question to restore into.
  assert.equal(resumePendingText({ text: "2.7", stepKey: "spring_f" }, null), null);
});

test("exactly one subject is accepted", () => {
  assert.deepEqual(parseSetupFillDraftSubject({ carId: "car1" }), { carId: "car1" });
  assert.deepEqual(parseSetupFillDraftSubject({ setupSheetModelId: "m1" }), {
    setupSheetModelId: "m1",
  });
  assert.deepEqual(parseSetupFillDraftSubject({ carId: " car1 " }), { carId: "car1" });

  assert.ok("error" in parseSetupFillDraftSubject({ carId: "car1", setupSheetModelId: "m1" }));
  assert.ok("error" in parseSetupFillDraftSubject({}));
  assert.ok("error" in parseSetupFillDraftSubject({ carId: "   " }));
  assert.ok("error" in parseSetupFillDraftSubject({ carId: 42 }));
});

test("progress reads the same everywhere it appears", () => {
  assert.equal(setupFillDraftProgressLabel(34, 68), "34 of 68 filled");
  assert.equal(setupFillDraftProgressLabel(0, 68), "0 of 68 filled");
  // A car whose template we couldn't resolve — never render "0 of 0 filled".
  assert.equal(setupFillDraftProgressLabel(0, 0), "In progress");
});

test("client-reported counts and strings are clamped before storage", () => {
  assert.equal(clampDraftCount(34), 34);
  assert.equal(clampDraftCount(-5), 0);
  assert.equal(clampDraftCount(999_999), 10_000);
  assert.equal(clampDraftCount("34"), 0);

  assert.equal(clampDraftText("  hi  ", 80), "hi");
  assert.equal(clampDraftText("   ", 80), null);
  assert.equal(clampDraftText(7, 80), null);
  assert.equal(clampDraftText("x".repeat(200), 80), "x".repeat(80));
});
