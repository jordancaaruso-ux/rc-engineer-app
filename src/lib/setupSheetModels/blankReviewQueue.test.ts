import assert from "node:assert/strict";
import {
  compareNameClashRows,
  groupNameClashes,
  oneRowPerChassis,
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
    isEdition: false,
    sheetCount: 1,
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

// --- A chassis with a second sheet is one row, spoken for by the upload that made it -----------
// Schumacher Cat PB, 2026-09-18: Chris uploaded the sheet that made it, the founder added an
// edition two hours later. Per upload it was listed twice and "clashed" with itself.
{
  const made = chassis({
    modelId: "catpb",
    blankId: "chris",
    chassisName: "Schumacher Cat PB",
    uploaderEmail: "chris@example.com",
    uploadedAt: new Date("2026-09-18T10:46:00Z"),
  });
  const edition = chassis({
    modelId: "catpb",
    blankId: "founder",
    chassisName: "Schumacher Cat PB",
    uploaderEmail: "founder@example.com",
    uploadedAt: new Date("2026-09-18T12:08:00Z"),
    isEdition: true,
  });
  const other = chassis({ modelId: "ld3", chassisName: "Schumacher LD3" });

  // Newest first, as the loader reads them: the edition comes before the upload that made it.
  const rows = oneRowPerChassis([edition, other, made]);
  assert.deepEqual(
    rows.map((r) => [r.modelId, r.blankId, r.sheetCount]),
    [
      ["catpb", "chris", 2],
      ["ld3", "blank-ld3", 1],
    ]
  );
  assert.equal(rows[0]!.uploaderEmail, "chris@example.com");
  assert.deepEqual(groupNameClashes(rows), []);
}

// --- With only editions left, the earliest speaks for the chassis ------------------------------
{
  const later = chassis({ modelId: "x", blankId: "later", isEdition: true, uploadedAt: new Date("2026-09-20T00:00:00Z") });
  const earlier = chassis({ modelId: "x", blankId: "earlier", isEdition: true, uploadedAt: new Date("2026-09-19T00:00:00Z") });
  assert.equal(oneRowPerChassis([later, earlier])[0]!.blankId, "earlier");
}

console.log("blankReviewQueue.test.ts ok");
