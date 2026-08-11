import assert from "node:assert/strict";
import type { SetupSheetModelSchema, SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import { applyBoxLabels, namedBoxCount } from "@/lib/setupSheetModels/applyBoxLabels";
import { universalParameterIdsBySchemaKey, resolveUniversalParameterId } from "@/lib/setupSheetModels/universalParameters";

function field(p: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: `Box 1 · page 1, upper left`,
    sectionId: "grp",
    sectionTitle: "Other",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: false,
    showInLogRun: false,
    sortOrder: 1,
    ...p,
  } as SetupSheetModelFieldDef;
}

function schemaOf(...fields: SetupSheetModelFieldDef[]): SetupSheetModelSchema {
  return { label: "Mugen MTC3", sections: [], fields } as unknown as SetupSheetModelSchema;
}

// --- The key never moves, whatever the label becomes -------------------------------------------
{
  const before = schemaOf(field({ key: "text47" }));
  const { schema, changed } = applyBoxLabels(before, { text47: "Camber (Front)" });
  assert.deepEqual(schema.fields.map((f) => f.key), ["text47"]);
  assert.equal(schema.fields[0]!.displayLabel, "Camber (Front)");
  assert.deepEqual(changed, ["text47"]);
}

// --- A name the app knows also declares the parameter it means ---------------------------------
{
  const { schema, pooled } = applyBoxLabels(schemaOf(field({ key: "text47" })), {
    text47: "Camber (Front)",
  });
  assert.deepEqual(pooled, [{ key: "text47", universalParameterId: "camber_front" }]);
  // The point of the declaration: this box now pools with front camber on every other car.
  const declared = universalParameterIdsBySchemaKey(schema);
  assert.equal(resolveUniversalParameterId("text47", declared), "camber_front");
}

// --- A name the app does not know is still a good name, it just pools nowhere -------------------
{
  const { schema, changed, pooled } = applyBoxLabels(schemaOf(field({ key: "text9" })), {
    text9: "Wire harness routing",
  });
  assert.deepEqual(changed, ["text9"]);
  assert.deepEqual(pooled, []);
  assert.equal(schema.fields[0]!.universalParameterId, undefined);
}

// --- Naming a box lets it into the log-run form and comparisons ---------------------------------
{
  const { schema } = applyBoxLabels(schemaOf(field({ key: "text47" })), { text47: "Droop (Rear)" });
  assert.equal(schema.fields[0]!.showInLogRun, true);
  assert.equal(schema.fields[0]!.showInAnalysis, true);
}

// --- One box out of a row of ticks stays out of analysis, named or not --------------------------
{
  const { schema } = applyBoxLabels(schemaOf(field({ key: "surface__b2", uiType: "checkbox" })), {
    surface__b2: "Surface: carpet",
  });
  assert.equal(schema.fields[0]!.showInLogRun, true);
  assert.equal(schema.fields[0]!.showInAnalysis, false, "box 2 of a tick row answers nothing on its own");
}

// --- An empty box means "not named", never "wipe the label" -------------------------------------
{
  const before = schemaOf(field({ key: "text1", displayLabel: "Box 1 · page 1, upper left" }));
  const { schema, changed } = applyBoxLabels(before, { text1: "   " });
  assert.deepEqual(changed, []);
  assert.equal(schema.fields[0]!.displayLabel, "Box 1 · page 1, upper left");
  assert.equal(schema.fields[0]!.showInLogRun, false, "an untouched box keeps being held out");
}

// --- A key this sheet does not have is reported, never invented ---------------------------------
{
  const { schema, unknownKeys } = applyBoxLabels(schemaOf(field({ key: "text1" })), {
    text1: "Ride height (Front)",
    not_on_this_sheet: "Camber (Rear)",
  });
  assert.deepEqual(unknownKeys, ["not_on_this_sheet"]);
  assert.equal(schema.fields.length, 1);
}

// --- Re-sending the same label is not a change ---------------------------------------------------
{
  const before = schemaOf(field({ key: "text1", displayLabel: "Camber (Front)" }));
  assert.deepEqual(applyBoxLabels(before, { text1: "Camber (Front)" }).changed, []);
}

// --- Counting what is left to do -----------------------------------------------------------------
{
  const schema = schemaOf(
    field({ key: "a", displayLabel: "Camber (Front)" }),
    field({ key: "b", displayLabel: "Box 2 · page 1, upper left" }),
    field({ key: "c", displayLabel: "Box 3 · page 1, upper left" })
  );
  assert.equal(namedBoxCount(schema), 1);
}

console.log("applyBoxLabels.test.ts ok");
