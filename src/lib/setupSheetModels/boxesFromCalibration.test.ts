import assert from "node:assert/strict";
import { boxesFromCalibrationMappings } from "@/lib/setupSheetModels/boxesFromCalibration";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

function widget(instanceIndex: number, x = 100, y = 200) {
  return {
    instanceIndex,
    pageNumber: 1,
    pageWidth: 1000,
    pageHeight: 1400,
    x,
    y,
    width: 50,
    height: 20,
    checkMark: "✔",
  };
}

function extraction(fields: Array<{ name: string; widgets: number }>): PdfFormFieldsExtraction {
  return {
    hasFormFields: true,
    pageCount: 1,
    fields: fields.map((f) => ({
      name: f.name,
      type: "Text",
      value: "",
      pageNumber: 1,
      widgets: Array.from({ length: f.widgets }, (_, i) => widget(i, 100 + i * 60)),
    })),
  };
}

function field(p: Partial<SetupSheetModelFieldDef> & { key: string }): SetupSheetModelFieldDef {
  return {
    displayLabel: p.key,
    sectionId: "s",
    sectionTitle: "S",
    valueType: "string",
    uiType: "text",
    showInSetupSheet: true,
    showInAnalysis: true,
    showInLogRun: true,
    sortOrder: 1,
    ...p,
  } as SetupSheetModelFieldDef;
}

// --- Keys come from the calibration, never from the PDF's field names ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([{ name: "Texte2", widgets: 1 }]),
    formFieldMappings: {
      camber_front: { pdfFieldName: "Texte2" } as PdfFormFieldMappingRule,
    },
    schema: { fields: [field({ key: "camber_front" })] },
  });
  assert.deepEqual(result.boxes.map((b) => b.key), ["camber_front"]);
  assert.equal(result.boxes[0]!.optionValue, undefined);
  assert.equal(result.boxes[0]!.x, 0.1);
  assert.deepEqual(result.unresolvedKeys, []);
}

// --- A widget-group row becomes one box per option, all sharing the parameter's key ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([{ name: "Check Box6", widgets: 3 }]),
    formFieldMappings: {
      diff_height_front: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box6",
        options: {
          Up: { widgetInstanceIndex: 0 },
          Mid: { widgetInstanceIndex: 1 },
          Down: { widgetInstanceIndex: 2 },
        },
      } as PdfFormFieldMappingRule,
    },
    schema: {
      fields: [
        field({
          key: "diff_height_front",
          uiType: "select",
          groupedOptionLabels: ["Up", "Mid", "Down"],
          groupedOptionValues: ["Up", "Mid", "Down"],
        }),
      ],
    },
  });
  assert.equal(result.boxes.length, 3);
  assert.ok(result.boxes.every((b) => b.key === "diff_height_front"));
  assert.deepEqual(result.boxes.map((b) => b.optionValue), ["Up", "Mid", "Down"]);
  // Ticks keep the mark the paper makes.
  assert.equal(result.boxes[0]!.style.checkMark, "✔");
}

// --- The box carries the SCHEMA's casing, because stored setups hold the schema's casing ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([{ name: "Check Box120", widgets: 2 }]),
    formFieldMappings: {
      top_deck_cuts: {
        mode: "multiSelectWidgetGroup",
        pdfFieldName: "Check Box120",
        options: { A: { widgetInstanceIndex: 0 }, B: { widgetInstanceIndex: 1 } },
      } as PdfFormFieldMappingRule,
    },
    schema: {
      fields: [
        field({
          key: "top_deck_cuts",
          uiType: "multiSelect",
          groupedOptionLabels: ["A", "B"],
          groupedOptionValues: ["a", "b"],
        }),
      ],
    },
  });
  assert.deepEqual(result.boxes.map((b) => b.optionValue), ["a", "b"]);
}

// --- Named-fields groups resolve each option through its own PDF field ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([
      { name: "Check Box17", widgets: 1 },
      { name: "Check Box18", widgets: 1 },
    ]),
    formFieldMappings: {
      chassis: {
        mode: "singleChoiceNamedFields",
        options: {
          C01RS: { pdfFieldName: "Check Box17", widgetInstanceIndex: 0 },
          "C01B-RC": { pdfFieldName: "Check Box18", widgetInstanceIndex: 0 },
        },
      } as PdfFormFieldMappingRule,
    },
    schema: {
      fields: [
        field({
          key: "chassis",
          uiType: "select",
          groupedOptionLabels: ["C01RS", "C01B-RC", "Other"],
          groupedOptionValues: ["C01RS", "C01B-RC", "Other"],
        }),
      ],
    },
  });
  assert.equal(result.boxes.length, 2);
  assert.deepEqual(result.boxes.map((b) => b.optionValue), ["C01RS", "C01B-RC"]);
}

// --- A text-line "option" is the paper's free-text choice: it belongs to the _other companion ---
{
  const ex = extraction([
    { name: "Check Box31", widgets: 1 },
    { name: "Text75", widgets: 1 },
  ]);
  // extraction() types everything "Text"; make the tick what the real file's tick is.
  ex.fields[0]!.type = "CheckBox";
  const result = boxesFromCalibrationMappings({
    extraction: ex,
    formFieldMappings: {
      front_bumper: {
        mode: "singleChoiceNamedFields",
        options: {
          C07R: { pdfFieldName: "Check Box31", widgetInstanceIndex: 0 },
          Other: { pdfFieldName: "Text75", widgetInstanceIndex: 0 },
        },
      } as PdfFormFieldMappingRule,
    },
    schema: {
      fields: [
        field({
          key: "front_bumper",
          uiType: "select",
          groupedOptionLabels: ["C07R", "Other"],
          groupedOptionValues: ["C07R", "Other"],
        }),
        field({ key: "front_bumper_other" }),
      ],
    },
  });
  assert.deepEqual(
    result.boxes.map((b) => `${b.key}${b.optionValue ? `=${b.optionValue}` : ""}`).sort(),
    ["front_bumper=C07R", "front_bumper_other"]
  );
}

// --- What the file can't honour is reported, never silently dropped ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([{ name: "Text28", widgets: 1 }]),
    formFieldMappings: {
      toe_front: { pdfFieldName: "Text28" } as PdfFormFieldMappingRule,
      gone_key: { pdfFieldName: "NotInThisFile" } as PdfFormFieldMappingRule,
      date: { pdfFieldName: "Text28" } as PdfFormFieldMappingRule,
    },
    schema: { fields: [field({ key: "toe_front" }), field({ key: "gone_key" })] },
  });
  assert.deepEqual(result.boxes.map((b) => b.key), ["toe_front"]);
  assert.deepEqual(result.unresolvedKeys, ["gone_key"]);
  assert.deepEqual(result.skippedCalibrationOnlyKeys, ["date"]);
}

// --- Supplements place computed keys the calibration never mapped; they never override it ---
{
  const result = boxesFromCalibrationMappings({
    extraction: extraction([
      { name: "Text91", widgets: 1 },
      { name: "Text28", widgets: 1 },
    ]),
    formFieldMappings: {
      toe_front: { pdfFieldName: "Text28" } as PdfFormFieldMappingRule,
    },
    schema: {
      fields: [field({ key: "toe_front" }), field({ key: "front_spring_rate_gf_mm" })],
    },
    extraSimpleKeys: {
      front_spring_rate_gf_mm: "Text91",
      // Calibration already owns toe_front; the supplement must lose.
      toe_front: "Text91",
      not_in_schema: "Text91",
    },
  });
  assert.equal(result.boxes.filter((b) => b.key === "toe_front").length, 1);
  const spring = result.boxes.find((b) => b.key === "front_spring_rate_gf_mm");
  assert.ok(spring);
  assert.deepEqual(result.skippedCalibrationOnlyKeys, ["not_in_schema"]);
}

console.log("boxesFromCalibration.test.ts ok");
