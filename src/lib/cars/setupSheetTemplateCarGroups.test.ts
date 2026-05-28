/**
 * Run: `npx tsx src/lib/cars/setupSheetTemplateCarGroups.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  carTemplateSelectGroups,
  shouldSkipSetupUploadCarPicker,
} from "./setupSheetTemplateCarGroups";

test("groups cars by setup sheet model name", () => {
  const groups = carTemplateSelectGroups([
    {
      id: "c1",
      name: "Race MTC3",
      setupSheetTemplate: null,
      setupSheetModelId: "m1",
      setupSheetModelName: "Mugen MTC3",
    },
  ]);
  assert.equal(groups.length, 1);
  assert.ok(groups[0]!.label.includes("Mugen MTC3"));
  assert.equal(groups[0]!.setupSheetModelId, "m1");
});

test("skips picker for single model group", () => {
  assert.equal(
    shouldSkipSetupUploadCarPicker([
      {
        id: "c1",
        name: "A",
        setupSheetTemplate: null,
        setupSheetModelId: "m1",
        setupSheetModelName: "Mugen MTC3",
      },
    ]),
    true
  );
});
