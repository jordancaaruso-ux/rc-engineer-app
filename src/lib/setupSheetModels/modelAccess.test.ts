/**
 * Run: `npx tsx --test src/lib/setupSheetModels/modelAccess.test.ts`
 *
 * The destructive rule, tested without a database. Deleting a chassis type reaches into other
 * people's accounts — Car.setupSheetModelId is SetNull, BaselineSetup and SetupFillDraft cascade —
 * so "may I edit this" and "may I destroy this" must not be the same question.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditSetupSheetModel,
  canManageSetupSheetModel,
  setupSheetModelUsedByOthers,
  type SetupSheetModelUsage,
} from "@/lib/setupSheetModels/modelAccess";

const CREATOR = { id: "u_creator", email: "driver@example.com" };
const STRANGER = { id: "u_stranger", email: "someone@example.com" };

function usage(p: Partial<SetupSheetModelUsage> = {}): SetupSheetModelUsage {
  return {
    otherUserCars: 0,
    otherUserFillDrafts: 0,
    otherUserDocuments: 0,
    otherUserCalibrations: 0,
    baselineSetups: 0,
    ...p,
  };
}

const UNAUTHORIZED_MINE = { userId: CREATOR.id, isAuthorized: false };

test("nothing depending on it: the creator may delete their own unauthorized type", () => {
  assert.equal(canManageSetupSheetModel(CREATOR, UNAUTHORIZED_MINE, usage()), true);
});

test("a stranger may never delete it, used or not", () => {
  assert.equal(canManageSetupSheetModel(STRANGER, UNAUTHORIZED_MINE, usage()), false);
});

test("once authorized, the creator loses destructive rights", () => {
  const authorized = { userId: CREATOR.id, isAuthorized: true };
  assert.equal(canManageSetupSheetModel(CREATOR, authorized, usage()), false);
});

test("every kind of other-user dependant blocks the creator", () => {
  const blockers: Array<keyof SetupSheetModelUsage> = [
    "otherUserCars",
    "otherUserFillDrafts",
    "otherUserDocuments",
    "otherUserCalibrations",
    "baselineSetups",
  ];
  for (const key of blockers) {
    const u = usage({ [key]: 1 });
    assert.equal(setupSheetModelUsedByOthers(u), true, `${key} should count as used`);
    assert.equal(
      canManageSetupSheetModel(CREATOR, UNAUTHORIZED_MINE, u),
      false,
      `${key} should block the creator`
    );
  }
});

test("the creator's own cars do not block them", () => {
  // loadModelUsage counts only rows belonging to somebody else, so a driver deleting a type that
  // only their own car uses stays unblocked. This pins the intent of that exclusion.
  assert.equal(setupSheetModelUsedByOthers(usage()), false);
  assert.equal(canManageSetupSheetModel(CREATOR, UNAUTHORIZED_MINE, usage()), true);
});

test("edit rights are deliberately looser than destructive rights", () => {
  const inUse = usage({ otherUserCars: 3 });
  // The schema editor page keeps offering itself...
  assert.equal(canEditSetupSheetModel(CREATOR, UNAUTHORIZED_MINE), true);
  // ...but the destructive path refuses. That gap is the point, not an inconsistency.
  assert.equal(canManageSetupSheetModel(CREATOR, UNAUTHORIZED_MINE, inUse), false);
});
