/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerGeneralContext.test.ts`
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleGeneralChatContext,
  formatGeneralCarIdentityLine,
  generalAnchorLabel,
  type GeneralCarIdentity,
} from "./engineerGeneralContext";

const CAR_1 = "clx0car0ddddddddddddddd";

const identity: GeneralCarIdentity = {
  carId: CAR_1,
  name: "TC4",
  chassis: "Awesomatix A800RR",
  platformLabel: "Touring car",
  line: "TC4 — Awesomatix A800RR, Touring car",
};

/**
 * The general-mode guarantee: no personal data reaches the model. The pipeline builds
 * this context WITHOUT calling the packet/summary/priors/memory/brain builders, and this
 * assembler must never grow a personal key — they are absent, not null, so any leak
 * fails here before it ships.
 */
const PERSONAL_KEYS = [
  "defaultDashboardContext",
  "engineerSummary",
  "focusedRunPair",
  "anchoredSavedSetup",
  "anchoredEventDigest",
  "tireLifePriors",
  "setupOutcomeMemory",
  "setupHandlingPaceBundle",
  "engineeringBrain",
  "reasoningSpine",
  "runCatalog",
  "patternDigest",
  "resolvedRunScope",
  "resolvedScopeTireSteps",
  "thingsToTry",
  "thingsToDo",
  "paceVsFieldRunDigest",
  "paceVsFieldRunDigestSubset",
] as const;

test("general context carries no personal keys — absent, not null", () => {
  const ctx = assembleGeneralChatContext({ carIdentity: identity, richEngineerContext: null });
  for (const key of PERSONAL_KEYS) {
    assert.equal(key in ctx, false, `personal key leaked into general context: ${key}`);
  }
  assert.deepEqual(Object.keys(ctx).sort(), [
    "contextTier",
    "generalCarIdentity",
    "pinnedFocus",
    "richEngineerContext",
  ]);
});

test("general context pins the general subject with the car identity", () => {
  const ctx = assembleGeneralChatContext({ carIdentity: identity, richEngineerContext: null });
  assert.equal(ctx.contextTier, "general");
  assert.deepEqual(ctx.pinnedFocus, {
    kind: "general",
    carId: CAR_1,
    label: "General · TC4",
    pinned: true,
  });
  assert.equal(ctx.generalCarIdentity, identity);
});

test("pure theory: null identity means no car anywhere in the context", () => {
  const ctx = assembleGeneralChatContext({ carIdentity: null, richEngineerContext: null });
  assert.deepEqual(ctx.pinnedFocus, {
    kind: "general",
    carId: null,
    label: "General",
    pinned: true,
  });
  assert.equal(ctx.generalCarIdentity, null);
});

test("identity line degrades gracefully as fields go missing", () => {
  assert.equal(
    formatGeneralCarIdentityLine(identity),
    "TC4 — Awesomatix A800RR, Touring car"
  );
  assert.equal(
    formatGeneralCarIdentityLine({ name: "TC4", chassis: null, platformLabel: "Touring car" }),
    "TC4 — Touring car"
  );
  assert.equal(
    formatGeneralCarIdentityLine({ name: "TC4", chassis: null, platformLabel: null }),
    "TC4"
  );
});

test("anchor label", () => {
  assert.equal(generalAnchorLabel(identity), "General · TC4");
  assert.equal(generalAnchorLabel(null), "General");
});

console.log("engineerGeneralContext.test.ts OK");
