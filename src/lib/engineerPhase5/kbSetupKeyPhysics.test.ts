/**
 * Run: `npx tsx src/lib/engineerPhase5/kbSetupKeyPhysics.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeMechanismChange } from "@/lib/engineerPhase5/setupMechanismMap";
import { describeSetupChangePerKb, kbPhysicsPromptLinesForKeys } from "@/lib/engineerPhase5/kbSetupKeyPhysics";

test("toe gain shims: fewer shims increases rear toe gain per KB", () => {
  const line = describeSetupChangePerKb("toe_gain_shims_rear", "2", "1");
  assert.ok(line);
  assert.match(line, /more rear toe gain/i);
  assert.match(line, /shim count decreased/i);

  const report = describeMechanismChange({ key: "toe_gain_shims_rear", before: "2", after: "1" });
  assert.ok(report.perMechanism.length > 0);
  const toe = report.perMechanism.find((m) => m.mechanism === "rear_toe_gain");
  assert.equal(toe?.effect, "more");
});

test("toe gain shims: more shims decreases rear toe gain per KB", () => {
  const report = describeMechanismChange({ key: "toe_gain_shims_rear", before: "1", after: "2" });
  assert.ok(report.perMechanism.length > 0);
  const toe = report.perMechanism.find((m) => m.mechanism === "rear_toe_gain");
  assert.equal(toe?.effect, "less");
});

test("kbPhysicsPromptLinesForKeys includes toe gain convention", () => {
  const lines = kbPhysicsPromptLinesForKeys(["toe_gain_shims_rear", "spring_rear"]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /fewer shims → more bump-in/i);
});
