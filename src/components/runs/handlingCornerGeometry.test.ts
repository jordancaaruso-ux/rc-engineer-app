/**
 * Run: `npx tsx src/components/runs/handlingCornerGeometry.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HAIRPIN_ENTRY_X,
  HAIRPIN_EXIT_X,
  hairpinPointAndTangent,
  phaseT,
  slipOffsetUnit,
} from "./handlingCornerGeometry";

test("entry phase sits on left straight", () => {
  const { x, y, tangentDeg } = hairpinPointAndTangent(phaseT("entry"));
  assert.equal(x, HAIRPIN_ENTRY_X);
  assert.ok(y > 50 && y < 100);
  assert.equal(tangentDeg, -90);
});

test("mid phase sits at hairpin apex", () => {
  const { x, y, tangentDeg } = hairpinPointAndTangent(phaseT("mid"));
  assert.ok(Math.abs(x - 60) < 0.01);
  assert.ok(Math.abs(y - 15) < 0.01);
  assert.equal(Math.abs(tangentDeg), 180);
});

test("exit phase sits on right straight", () => {
  const { x, y, tangentDeg } = hairpinPointAndTangent(phaseT("exit"));
  assert.equal(x, HAIRPIN_EXIT_X);
  assert.ok(y > 50 && y < 100);
  assert.equal(tangentDeg, 90);
});

test("slip offset is unit length for understeer", () => {
  const { ox, oy } = slipOffsetUnit(-90, "understeer");
  assert.ok(Math.abs(ox * ox + oy * oy - 1) < 1e-5);
});
