import assert from "node:assert/strict";
import {
  compareNameClashRows,
  groupNameClashes,
  type BlankQueueChassis,
} from "@/lib/setupSheetModels/blankReviewQueue";

function chassis(p: Partial<BlankQueueChassis> & { modelId: string }): BlankQueueChassis {
  return {
    blankId: `blank-${p.modelId}`,
    chassisName: "Mugen MTC3",
    typedNameIfDifferent: null,
    uploaderEmail: "a@example.com",
    uploadedAt: new Date("2026-08-01T00:00:00Z"),
    pageCount: 1,
    boxCount: 193,
    namedCount: 0,
    carCount: 0,
    isAuthorized: false,
    suggestionCount: 0,
    ...p,
  };
}

// --- A name only clashes when more than one chassis answers to it ----------------------------
{
  const clashes = groupNameClashes([
    chassis({ modelId: "a", chassisName: "Mugen MTC3" }),
    chassis({ modelId: "b", chassisName: "Xray X4 '26" }),
  ]);
  assert.deepEqual(clashes, []);
}

// --- Case and stray spacing do not hide a clash ------------------------------------------------
{
  const clashes = groupNameClashes([
    chassis({ modelId: "a", chassisName: "Mugen MTC3" }),
    chassis({ modelId: "b", chassisName: "mugen mtc3 " }),
  ]);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0]!.rows.length, 2);
}

// --- The curated chassis is the one to look at first ------------------------------------------
{
  const authorized = chassis({ modelId: "curated", isAuthorized: true, carCount: 0 });
  const busy = chassis({ modelId: "busy", carCount: 9, namedCount: 100 });
  assert.equal([busy, authorized].sort(compareNameClashRows)[0]!.modelId, "curated");
}

// --- Otherwise the one drivers actually use leads ----------------------------------------------
{
  const used = chassis({ modelId: "used", carCount: 4 });
  const named = chassis({ modelId: "named", carCount: 0, namedCount: 150 });
  assert.equal([named, used].sort(compareNameClashRows)[0]!.modelId, "used");
}

// --- Same cars: the one further through naming leads -------------------------------------------
{
  const bare = chassis({ modelId: "bare", carCount: 2, namedCount: 0 });
  const named = chassis({ modelId: "named", carCount: 2, namedCount: 40 });
  assert.equal([bare, named].sort(compareNameClashRows)[0]!.modelId, "named");
}

// --- Dead level: the one that arrived first leads ----------------------------------------------
{
  const older = chassis({ modelId: "older", uploadedAt: new Date("2026-07-01T00:00:00Z") });
  const newer = chassis({ modelId: "newer", uploadedAt: new Date("2026-08-09T00:00:00Z") });
  assert.equal([newer, older].sort(compareNameClashRows)[0]!.modelId, "older");
}

// --- A clash is reported even when one side is already curated ---------------------------------
{
  const clashes = groupNameClashes([
    chassis({ modelId: "curated", isAuthorized: true }),
    chassis({ modelId: "fresh" }),
  ]);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0]!.rows[0]!.modelId, "curated");
}

console.log("blankReviewQueue.test.ts ok");
