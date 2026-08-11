import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfFormFields } from "@/lib/setupDocuments/pdfFormFields";
import { deriveSchemaFromAcroForm } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import { DEBUG_SHEET_BLANKS } from "@/lib/setupSheetModels/debugSheetBlanks";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import {
  buildSheetPlan,
  chassisFillsAsSheet,
  parseStoredBoxes,
} from "@/lib/setupSheetModels/sheetPlan";

function box(key: string, page = 1) {
  return {
    key,
    pageNumber: page,
    x: 0.1,
    y: 0.2,
    width: 0.1,
    height: 0.02,
    style: {
      fontFamily: "Helvetica",
      bold: false,
      italic: false,
      color: "#000",
      alignment: "left" as const,
      fontSizeFrac: 0,
    },
  };
}

function field(p: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: p.key,
    sectionId: "grp",
    sectionTitle: "Section",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: false,
    sortOrder: 1,
    ...p,
  } as SetupSheetModelFieldDef;
}

// --- A parameter with nowhere to sit on the paper is left out, not drawn somewhere invented ---
{
  const plan = buildSheetPlan({
    schema: {
      fields: [
        field({ key: "fr_camber", displayLabel: "Fr camber", sortOrder: 1 }),
        field({ key: "added_by_hand", displayLabel: "Added by hand", sortOrder: 2 }),
      ],
    },
    boxes: [box("fr_camber")],
  });
  assert.deepEqual(plan.fields.map((f) => f.key), ["fr_camber"]);
  assert.equal(plan.boxes.length, 1);
}

// --- Named and unnamed boxes are told apart by the label the derivation generated ---
{
  const plan = buildSheetPlan({
    schema: {
      fields: [
        field({ key: "fr_camber", displayLabel: "Fr camber" }),
        field({ key: "text47", displayLabel: "Box 47 · page 2, upper left" }),
      ],
    },
    boxes: [box("fr_camber"), box("text47", 2)],
  });
  assert.equal(plan.fields[0]!.unnamed, false);
  assert.equal(plan.fields[1]!.unnamed, true);
  assert.equal(plan.namedCount, 1);
  assert.equal(plan.pageCount, 2, "page count follows the boxes, not the schema");
}

// --- Field order is the schema's order, which is the order the driver reads the paper in ---
{
  const plan = buildSheetPlan({
    schema: {
      fields: [
        field({ key: "c", sortOrder: 1 }),
        field({ key: "a", sortOrder: 2 }),
        field({ key: "b", sortOrder: 3 }),
      ],
    },
    // Deliberately shuffled: the stored geometry must not be what decides the sweep.
    boxes: [box("a"), box("b"), box("c")],
  });
  assert.deepEqual(plan.fields.map((f) => f.key), ["c", "a", "b"]);
  assert.deepEqual(plan.boxes.map((b) => b.key), ["c", "a", "b"]);
}

// --- A grouped parameter keeps EVERY printed tick box, and the plan says what each one means ---
{
  const plan = buildSheetPlan({
    schema: {
      fields: [
        field({
          key: "diff_height",
          displayLabel: "Diff height",
          uiType: "select",
          sortOrder: 1,
          groupedOptionLabels: ["Up", "Mid", "Down"],
          groupedOptionValues: ["Up", "Mid", "Down"],
        }),
        field({
          key: "top_deck_cuts",
          displayLabel: "Top deck cuts",
          uiType: "multiSelect",
          sortOrder: 2,
          groupedOptionLabels: ["A", "B"],
          groupedOptionValues: ["a", "b"],
        }),
        field({ key: "camber", displayLabel: "Camber", sortOrder: 3 }),
      ],
    },
    boxes: [
      { ...box("diff_height"), optionValue: "Up" },
      { ...box("diff_height"), optionValue: "Mid" },
      { ...box("diff_height"), optionValue: "Down" },
      { ...box("top_deck_cuts"), optionValue: "a" },
      { ...box("top_deck_cuts"), optionValue: "b" },
      box("camber"),
    ],
  });
  // One FIELD per parameter, however many boxes it prints as.
  assert.deepEqual(plan.fields.map((f) => f.key), ["diff_height", "top_deck_cuts", "camber"]);
  assert.equal(plan.boxes.length, 6, "every printed tick box survives");
  assert.deepEqual(plan.fields[0]!.optionValues, ["Up", "Mid", "Down"]);
  assert.equal(plan.fields[0]!.multi, undefined);
  assert.equal(plan.fields[1]!.multi, true);
  assert.equal(plan.fields[2]!.optionValues, undefined);
  // Option boxes still travel to the browser as JSON without losing what they mean.
  const roundTripped = parseStoredBoxes(JSON.parse(JSON.stringify(plan.boxes)));
  assert.equal(roundTripped.filter((b) => b.optionValue).length, 5);
}

// --- An empty sheet is one page, not negative infinity ---
{
  const plan = buildSheetPlan({ schema: { fields: [] }, boxes: [] });
  assert.equal(plan.pageCount, 1);
  assert.equal(plan.namedCount, 0);
}

// --- Sheet mode turns on geometry, never on how much naming is left ---
{
  assert.equal(chassisFillsAsSheet(null), false);
  assert.equal(chassisFillsAsSheet({ boxesJson: [] }), false, "nothing to draw");
  assert.equal(chassisFillsAsSheet({ boxesJson: [box("a")] }), true);
  // The founder's override, and the only thing that may switch a chassis back.
  assert.equal(chassisFillsAsSheet({ boxesJson: [box("a")], fillSurface: "form" }), false);
  assert.equal(chassisFillsAsSheet({ boxesJson: [box("a")], fillSurface: "sheet" }), true);
}

// --- Stored geometry is read defensively: a malformed row must not break the sheet ---
{
  assert.deepEqual(parseStoredBoxes(null), []);
  assert.deepEqual(parseStoredBoxes({ nope: 1 }), []);
  const parsed = parseStoredBoxes([
    box("good"),
    { key: "no_page", x: 0, y: 0, width: 1, height: 1 },
    { pageNumber: 1, x: 0, y: 0, width: 1, height: 1 },
    null,
    "nonsense",
  ]);
  assert.deepEqual(parsed.map((b) => b.key), ["good"]);
}

// --- The real sheets: every box the driver can see is one their schema declares ---
async function realSheets() {
  for (const [id, blank] of Object.entries(DEBUG_SHEET_BLANKS)) {
    const extraction = await extractPdfFormFields(readFileSync(join(process.cwd(), blank.path)));
    const derived = deriveSchemaFromAcroForm(extraction, blank.label);

    // The round trip the production path actually takes: derive, store as JSON, read back, draw.
    const stored = parseStoredBoxes(JSON.parse(JSON.stringify(derived.boxes)));
    assert.equal(stored.length, derived.boxes.length, `${id}: geometry lost in storage`);

    const plan = buildSheetPlan({ schema: derived.schema, boxes: stored });
    assert.equal(
      plan.fields.length,
      derived.schema.fields.length,
      `${id}: a parameter lost its box`
    );
    assert.equal(plan.boxes.length, plan.fields.length, `${id}: a box without a field`);
    assert.deepEqual(
      plan.boxes.map((b) => b.key),
      plan.fields.map((f) => f.key),
      `${id}: boxes and fields must stay in step, the surface pairs them by index`
    );
    assert.ok(plan.pageCount >= 1 && plan.pageCount <= 8, `${id}: implausible page count`);
  }

  // The hard case, stated: Mugen names nothing, so every box is positional and the founder's
  // naming queue for that chassis is the whole sheet.
  const mugen = DEBUG_SHEET_BLANKS["mugen-mtc3"];
  const ex = await extractPdfFormFields(readFileSync(join(process.cwd(), mugen.path)));
  const plan = buildSheetPlan(deriveSchemaFromAcroForm(ex, mugen.label));
  assert.equal(plan.namedCount, 0, "nobody has named a Mugen box");
  assert.ok(plan.fields.every((f) => f.unnamed));
  assert.ok(plan.fields.length > 100, "but every one of them is still fillable");
}

void realSheets().then(() => console.log("sheetPlan.test.ts ok"));
