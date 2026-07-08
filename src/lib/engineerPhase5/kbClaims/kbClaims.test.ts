/**
 * Run: node --conditions=react-server --import tsx src/lib/engineerPhase5/kbClaims/kbClaims.test.ts
 *
 * Proof test for the claim-ID schema (ENGINEER_SUGGESTION_QUALITY_PLAN.md 2a). The
 * registry ships EMPTY and gated; these example claims live only in the test, proving the
 * machine (validator + id allocator + retirement chain) works before any content lands.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCiteString, type KbClaim } from "@/lib/engineerPhase5/kbClaims/types";
import {
  KB_CLAIMS,
  activeClaims,
  claimById,
  isWellFormedClaimId,
  nextClaimId,
} from "@/lib/engineerPhase5/kbClaims/registry";
import { kbClaimsAreValid, validateKbClaims } from "@/lib/engineerPhase5/kbClaims/validate";

// A tiny, well-formed example set — the shape an approved-prose atomization would produce.
const EXAMPLE: KbClaim[] = [
  {
    id: "vdk-0001",
    kbSource: "camber-caster-toe.md",
    kbSection: "rear-toe",
    kbTier: "approved",
    claimClass: "physics_mechanism",
    predictability: "usual",
    evidence: "derived_from_approved_prose",
    statement: "More rear toe-in usually increases rear grip at the cost of rotation and often corner speed.",
    parameterKey: "toe_rear",
    effect: { outcome: "rear_grip", phase: "all", dir: "+", strength: "moderate" },
  },
  {
    id: "vdk-0002",
    kbSource: "damper-oil.md",
    kbSection: "damper-oil",
    kbTier: "approved",
    claimClass: "physics_mechanism",
    predictability: "situational",
    evidence: "physics_derivation",
    conditions: "surface grip + bump frequency; clearer on rough/low-grip",
    statement: "Thicker damper oil slows shaft speed, shifting more transient load onto the tyre.",
  },
];

test("registry ships EMPTY and structurally valid (dormant infra)", () => {
  assert.equal(KB_CLAIMS.length, 0);
  assert.ok(kbClaimsAreValid(KB_CLAIMS));
});

test("well-formed example claim set validates clean", () => {
  assert.deepEqual(validateKbClaims(EXAMPLE), []);
});

test("id allocator is monotonic, padded, and skips retired ordinals", () => {
  assert.equal(nextClaimId([]), "vdk-0001");
  assert.equal(nextClaimId(EXAMPLE), "vdk-0003");
  const withRetired: KbClaim[] = [
    { ...EXAMPLE[0], id: "vdk-0007", retired: true, supersededBy: "vdk-0009" },
  ];
  // Must not reuse 0007 or the superseded 0009.
  assert.equal(nextClaimId(withRetired), "vdk-0010");
});

test("id well-formedness check is independent of the registry", () => {
  assert.ok(isWellFormedClaimId("vdk-0042"));
  assert.ok(!isWellFormedClaimId("camber-caster-toe.md#rear-toe"));
  assert.ok(!isWellFormedClaimId("vdk-42"));
});

test("catches malformed + duplicate ids", () => {
  const bad: KbClaim[] = [
    { ...EXAMPLE[0], id: "rear-toe-1" },
    { ...EXAMPLE[1], id: "vdk-0001" },
    { ...EXAMPLE[0], id: "vdk-0001" }, // duplicate
  ];
  const issues = validateKbClaims(bad);
  assert.ok(issues.some((i) => i.problem.includes("malformed id")));
  assert.ok(issues.some((i) => i.problem.includes("duplicate id")));
});

test("situational predictability requires conditions", () => {
  const missing: KbClaim[] = [{ ...EXAMPLE[1], conditions: undefined }];
  assert.ok(validateKbClaims(missing).some((i) => i.problem.includes("situational")));
});

test("physics_mechanism cannot be sourced from a single driver's outcome", () => {
  const bad: KbClaim[] = [{ ...EXAMPLE[0], evidence: "this_driver_outcome" }];
  assert.ok(validateKbClaims(bad).some((i) => i.problem.includes("this_driver_outcome")));
});

test("retirement chain: dangling and cyclic supersession are caught", () => {
  const dangling: KbClaim[] = [{ ...EXAMPLE[0], retired: true, supersededBy: "vdk-9999" }];
  assert.ok(validateKbClaims(dangling).some((i) => i.problem.includes("unknown claim")));

  const cycle: KbClaim[] = [
    { ...EXAMPLE[0], id: "vdk-0001", retired: true, supersededBy: "vdk-0002" },
    { ...EXAMPLE[1], id: "vdk-0002", retired: true, supersededBy: "vdk-0001" },
  ];
  assert.ok(validateKbClaims(cycle).some((i) => i.problem.includes("cycle")));
});

test("supersededBy without retired flag is flagged", () => {
  const bad: KbClaim[] = [
    { ...EXAMPLE[0], id: "vdk-0001", supersededBy: "vdk-0002" },
    { ...EXAMPLE[1], id: "vdk-0002" },
  ];
  assert.ok(validateKbClaims(bad).some((i) => i.problem.includes("not marked retired")));
});

test("helpers: activeClaims filters retired, claimById finds retired, cite string shape", () => {
  const set: KbClaim[] = [EXAMPLE[0], { ...EXAMPLE[1], retired: true }];
  assert.equal(activeClaims(set).length, 1);
  assert.equal(claimById("vdk-0002", set)?.id, "vdk-0002"); // retired still findable
  assert.equal(claimCiteString(EXAMPLE[0]), "camber-caster-toe.md#rear-toe (vdk-0001)");
});
