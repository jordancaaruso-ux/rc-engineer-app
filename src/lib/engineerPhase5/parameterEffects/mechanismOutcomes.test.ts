/**
 * Run: npm run test:mechanism-outcomes
 *
 * Proves the "explanation → usable info" funnel end-to-end on ONE worked example,
 * WITHOUT authoring any real knowledge. The FIXTURE below is fabricated purely to
 * exercise the machine — it is NOT KB-derived, NOT ground truth, and lives only
 * in this test. The real MECHANISM_OUTCOME_CATALOG stays empty + human-gated.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectOutcomeIntent } from "@/lib/engineerPhase5/parameterEffects/intentFromMessage";
import {
  deriveLeversForGoal,
  deriveOutcomesForParameter,
  findContradictions,
  findMissingCitations,
  summarizeLevers,
  validateMechanismOutcomeCatalog,
  type MechanismOutcomeEntry,
} from "@/lib/engineerPhase5/parameterEffects/mechanismOutcomes";

/**
 * FIXTURE — fabricated, NOT real KB. Two claims about ONE mechanism
 * (`rear_support`). Note we author the physics ONCE here; the funnel reuses it
 * for every part that touches rear support.
 */
const FIXTURE: MechanismOutcomeEntry[] = [
  {
    mechanism: "rear_support",
    outcome: "rear_grip",
    phase: "mid",
    dir: "-", // (fabricated) more rear support → less mid rear grip
    hedge: false,
    strength: "strong",
    conditions: "fixture only",
    kbSource: "fixture.md",
    kbSection: "rear-support",
  },
  {
    mechanism: "rear_support",
    outcome: "on_power_stability",
    phase: "on_power",
    dir: "+", // (fabricated) more rear support → more on-power stability
    hedge: false,
    strength: "moderate",
    kbSource: "fixture.md",
    kbSection: "rear-support",
  },
];

test("derive: a part that ADDS the mechanism inherits the mechanism's direction", () => {
  // spring_rear → rear_support "more" (sign +1). So raising spring_rear keeps
  // the fixture directions: -rear_grip(mid), +on_power_stability.
  const derived = deriveOutcomesForParameter("spring_rear", FIXTURE);
  const rearGrip = derived.find((d) => d.outcome === "rear_grip" && d.phase === "mid");
  const stability = derived.find((d) => d.outcome === "on_power_stability");
  assert.ok(rearGrip, "expected a rear_grip lever");
  assert.equal(rearGrip!.dir, "-");
  assert.ok(stability, "expected an on_power_stability lever");
  assert.equal(stability!.dir, "+");
});

test("derive: a part that REDUCES the mechanism flips the direction (no silent sign errors)", () => {
  // upper_inner_shims_rr → rear_support "less" (sign -1). The fixture says more
  // rear support REDUCES mid rear grip, so a part that reduces support must
  // INCREASE it. This is the guarantee the flat catalog couldn't make.
  const derived = deriveOutcomesForParameter("upper_inner_shims_rr", FIXTURE);
  const rearGrip = derived.find((d) => d.outcome === "rear_grip" && d.phase === "mid");
  assert.ok(rearGrip, "expected a rear_grip lever");
  assert.equal(rearGrip!.dir, "+", "reducing rear support must flip the outcome");
});

test("goal: resolves to the correct move direction per part", () => {
  const levers = deriveLeversForGoal({
    outcome: "rear_grip",
    direction: "increase",
    parameterKeys: ["spring_rear", "upper_inner_shims_rr"],
    catalog: FIXTURE,
  });
  const byKey = new Map(levers.map((l) => [l.parameterKey, l]));
  // spring_rear ADDS support which LOSES mid grip → to GAIN grip, move it DOWN.
  assert.equal(byKey.get("spring_rear")?.recommendedMoveDirection, "down");
  // upper_inner_shims_rr REDUCES support which GAINS grip → move it UP.
  assert.equal(byKey.get("upper_inner_shims_rr")?.recommendedMoveDirection, "up");
});

test("checker: catches a silent contradiction", () => {
  const contradictory: MechanismOutcomeEntry[] = [
    { ...FIXTURE[0], dir: "+" },
    { ...FIXTURE[0], dir: "-" },
  ];
  const issues = findContradictions(contradictory);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.level, "error");
});

test("checker: an explicit 'it depends' (both hedged) is allowed", () => {
  const hedged: MechanismOutcomeEntry[] = [
    { ...FIXTURE[0], dir: "+", hedge: true },
    { ...FIXTURE[0], dir: "-", hedge: true },
  ];
  assert.equal(findContradictions(hedged).length, 0);
});

test("checker: blocks a missing citation", () => {
  const uncited: MechanismOutcomeEntry[] = [{ ...FIXTURE[0], kbSource: "" }];
  const issues = findMissingCitations(uncited);
  assert.ok(issues.some((i) => i.level === "error" && /kbSource/.test(i.message)));
});

test("the shipped (empty) catalog is valid", () => {
  assert.deepEqual(validateMechanismOutcomeCatalog(), []);
});

test("round-trip: a real sentence → goal → sign-correct, cited levers", () => {
  // Words in, recommendation out — the whole funnel.
  const message = "the car is loose on power on corner exit";
  const intent = detectOutcomeIntent(message);
  assert.ok(intent, "intent classifier should catch this");
  assert.equal(intent!.outcome, "on_power_stability");
  assert.equal(intent!.direction, "increase");

  const levers = deriveLeversForGoal({
    outcome: intent!.outcome,
    direction: intent!.direction,
    parameterKeys: ["spring_rear", "upper_inner_shims_rr"],
    catalog: FIXTURE,
  });
  // more rear support → +stability, so adding support (spring_rear UP) helps.
  const spring = levers.find((l) => l.parameterKey === "spring_rear");
  assert.ok(spring);
  assert.equal(spring!.recommendedMoveDirection, "up");

  // Print the funnel output so a human can read what the machine produced.
  console.log("\n--- FUNNEL OUTPUT (fixture knowledge) ---");
  console.log(`message: "${message}"`);
  console.log(`intent : ${intent!.outcome} / ${intent!.direction} (matched "${intent!.matchedPhrase}")`);
  for (const line of summarizeLevers(`${intent!.direction} ${intent!.outcome}`, levers)) {
    console.log(line);
  }
  console.log("-----------------------------------------\n");
});
