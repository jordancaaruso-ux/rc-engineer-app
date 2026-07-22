/**
 * Run: `npx tsx --test src/lib/setup/setupFillOrder.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSetupFillSteps, setupFillSections } from "@/lib/setup/setupFillOrder";
import { buildSetupSheetTemplateFromParsedSchema } from "@/lib/setupSheetModels/buildSetupSheetTemplate";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

function schema(): SetupSheetModelSchema {
  return {
    version: 1,
    label: "Xray X4",
    structuredSections: [
      {
        id: "front",
        title: "Front",
        rows: [{ type: "pair", label: "Ride height", leftKey: "rh_f", rightKey: "rh_r", unit: "mm" }],
      },
    ],
    fields: [
      {
        key: "rh_f",
        displayLabel: "Ride height front",
        sectionId: "front",
        sectionTitle: "Front",
        valueType: "number",
        uiType: "text",
        unit: "mm",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 0,
      },
      {
        key: "arb_f",
        displayLabel: "ARB front",
        sectionId: "front",
        sectionTitle: "Front",
        valueType: "enum",
        uiType: "select",
        groupedOptionLabels: ["1.1", "1.2", "1.3"],
        groupedOptionValues: ["f_1_1", "f_1_2", "f_1_3"],
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 1,
      },
      {
        key: "options",
        displayLabel: "Fitted options",
        sectionId: "misc",
        sectionTitle: "Misc",
        valueType: "multi",
        uiType: "multiSelect",
        groupedOptionLabels: ["Fan", "Body posts"],
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 2,
      },
      {
        key: "notes",
        displayLabel: "Notes",
        sectionId: "misc",
        sectionTitle: "Misc",
        valueType: "string",
        uiType: "text",
        showInSetupSheet: true,
        showInAnalysis: true,
        showInLogRun: true,
        sortOrder: 3,
      },
    ],
  };
}

test("each field becomes one step, in schema sortOrder, with the right control", () => {
  const tpl = buildSetupSheetTemplateFromParsedSchema("m1", "Xray X4", schema());
  const steps = buildSetupFillSteps(tpl);

  assert.deepEqual(
    steps.map((s) => [s.key, s.kind]),
    [
      ["rh_f", "number"],
      ["arb_f", "choice"],
      ["options", "multiChoice"],
      ["notes", "text"],
    ]
  );
});

test("choice steps carry display labels and stored tokens", () => {
  const tpl = buildSetupSheetTemplateFromParsedSchema("m1", "Xray X4", schema());
  const arb = buildSetupFillSteps(tpl).find((s) => s.key === "arb_f");
  assert.deepEqual(arb?.options, ["1.1", "1.2", "1.3"]);
  assert.deepEqual(arb?.optionValues, ["f_1_1", "f_1_2", "f_1_3"]);
});

test("multi-select without declared stored values gets tokens derived from its labels", () => {
  // normalizeGroupedFieldOnField slugifies labels when the schema declares no explicit values,
  // so the fill flow always has a stored token to write — same tokens the grid sheet uses.
  const tpl = buildSetupSheetTemplateFromParsedSchema("m1", "Xray X4", schema());
  const opts = buildSetupFillSteps(tpl).find((s) => s.key === "options");
  assert.deepEqual(opts?.options, ["Fan", "Body posts"]);
  assert.deepEqual(opts?.optionValues, ["fan", "body_posts"]);
});

test("progress counters are per section", () => {
  const tpl = buildSetupSheetTemplateFromParsedSchema("m1", "Xray X4", schema());
  const steps = buildSetupFillSteps(tpl);
  assert.deepEqual(
    steps.map((s) => `${s.sectionTitle} ${s.indexInSection}/${s.sectionSize}`),
    ["Front 1/2", "Front 2/2", "Misc 1/2", "Misc 2/2"]
  );
  assert.deepEqual(
    setupFillSections(steps).map((s) => [s.title, s.firstStepIndex, s.size]),
    [
      ["Front", 0, 2],
      ["Misc", 2, 2],
    ]
  );
});

test("a key repeated across layout rows is asked exactly once", () => {
  const tpl: SetupSheetTemplate = {
    id: "t",
    label: "T",
    groups: [
      {
        id: "s",
        title: "S",
        fields: [
          { key: "a", label: "A", editable: true },
          { key: "a", label: "A again", editable: true },
          { key: "b", label: "B", editable: true },
        ],
      },
    ],
  };
  assert.deepEqual(
    buildSetupFillSteps(tpl).map((s) => s.key),
    ["a", "b"]
  );
});

test("display-only fields are skipped", () => {
  const tpl: SetupSheetTemplate = {
    id: "t",
    label: "T",
    groups: [
      {
        id: "s",
        title: "S",
        fields: [
          { key: "readonly", label: "Derived", editable: false },
          { key: "b", label: "B", editable: true },
        ],
      },
    ],
  };
  assert.deepEqual(
    buildSetupFillSteps(tpl).map((s) => s.key),
    ["b"]
  );
});
