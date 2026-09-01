import assert from "node:assert/strict";
import {
  pairWidgetsByGeometry,
  transferMappingsByGeometry,
} from "@/lib/setupSheetModels/alignEditionByGeometry";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

type Spec = {
  name: string;
  type?: string;
  widgets: Array<{ x: number; y: number; w?: number; h?: number }>;
};

function extraction(fields: Spec[]): PdfFormFieldsExtraction {
  return {
    hasFormFields: true,
    pageCount: 1,
    fields: fields.map((f) => ({
      name: f.name,
      type: (f.type ?? "Text") as never,
      value: "",
      pageNumber: 1,
      widgets: f.widgets.map((w, i) => ({
        instanceIndex: i,
        pageNumber: 1,
        pageWidth: 595,
        pageHeight: 842,
        x: w.x,
        y: w.y,
        width: w.w ?? 20,
        height: w.h ?? 14,
      })),
    })),
  };
}

// --- A renamed box at the same position: the rule follows the new name ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([{ name: "Texte2", widgets: [{ x: 86, y: 525 }] }]),
    edition: extraction([{ name: "Front Camber", widgets: [{ x: 86, y: 525 }] }]),
    formFieldMappings: {
      camber_front: { pdfFieldName: "Texte2" } as PdfFormFieldMappingRule,
    },
  });
  assert.deepEqual(result.formFieldMappings.camber_front, {
    pdfFieldName: "Front Camber",
    widgetInstanceIndex: 0,
  });
  assert.equal(result.dropped.length, 0);
}

// --- A widget-group choice row keeps its options when the shared name changes ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([
      { name: "Check Box48", type: "CheckBox", widgets: [{ x: 214, y: 369 }, { x: 248, y: 369 }, { x: 279, y: 369 }] },
    ]),
    edition: extraction([
      { name: "Front PSS Setting", type: "CheckBox", widgets: [{ x: 214, y: 369 }, { x: 248, y: 369 }, { x: 279, y: 369 }] },
    ]),
    formFieldMappings: {
      pss_percent_setup_front: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box48",
        options: { "30%": { widgetInstanceIndex: 0 }, "50%": { widgetInstanceIndex: 1 }, "70%": { widgetInstanceIndex: 2 } },
      },
    },
  });
  const rule = result.formFieldMappings.pss_percent_setup_front as {
    mode: string;
    pdfFieldName: string;
    options: Record<string, { widgetInstanceIndex: number }>;
  };
  assert.equal(rule.mode, "singleChoiceWidgetGroup");
  assert.equal(rule.pdfFieldName, "Front PSS Setting");
  assert.deepEqual(rule.options["50%"], { widgetInstanceIndex: 1 });
}

// --- A shared-name group whose ticks got DIFFERENT names becomes a named-fields rule ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([
      { name: "Check Box6", type: "CheckBox", widgets: [{ x: 89, y: 341 }, { x: 114, y: 341 }] },
    ]),
    edition: extraction([
      { name: "Drive Pos A", type: "CheckBox", widgets: [{ x: 89, y: 341 }] },
      { name: "Drive Pos B", type: "CheckBox", widgets: [{ x: 114, y: 341 }] },
    ]),
    formFieldMappings: {
      drive_position_front: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box6",
        options: { A: { widgetInstanceIndex: 0 }, B: { widgetInstanceIndex: 1 } },
      },
    },
  });
  const rule = result.formFieldMappings.drive_position_front as {
    mode: string;
    options: Record<string, { pdfFieldName: string; widgetInstanceIndex?: number }>;
  };
  assert.equal(rule.mode, "singleChoiceNamedFields");
  assert.equal(rule.options.A!.pdfFieldName, "Drive Pos A");
  assert.equal(rule.options.B!.pdfFieldName, "Drive Pos B");
}

// --- A nudged box still transfers; a 10pt tick-box grid does not cross-claim ---
{
  const pairing = pairWidgetsByGeometry(
    extraction([
      { name: "Text53", widgets: [{ x: 318, y: 126, w: 118, h: 18 }] },
      { name: "Check Box91", type: "CheckBox", widgets: [{ x: 467, y: 275, w: 7, h: 39 }] },
      { name: "Check Box92", type: "CheckBox", widgets: [{ x: 474, y: 275, w: 7, h: 39 }] },
    ]),
    extraction([
      { name: "ESC", widgets: [{ x: 320, y: 139, w: 116, h: 14 }] },
      { name: "Tire Surface 1", type: "CheckBox", widgets: [{ x: 467, y: 275, w: 7, h: 39 }] },
      { name: "Tire Surface 2", type: "CheckBox", widgets: [{ x: 474, y: 275, w: 7, h: 39 }] },
    ])
  );
  assert.equal(pairing.byPrimaryRef.get("Text53#0")?.loc.fieldName, "ESC");
  assert.equal(pairing.byPrimaryRef.get("Check Box91#0")?.loc.fieldName, "Tire Surface 1");
  assert.equal(pairing.byPrimaryRef.get("Check Box92#0")?.loc.fieldName, "Tire Surface 2");
}

// --- A nudged box between two equally plausible targets is left alone, not guessed ---
{
  const pairing = pairWidgetsByGeometry(
    extraction([{ name: "Text50", widgets: [{ x: 505, y: 160 }] }]),
    extraction([
      { name: "Inner Travel", widgets: [{ x: 505, y: 170 }] },
      { name: "Outer Travel", widgets: [{ x: 505, y: 150 }] },
    ])
  );
  assert.equal(pairing.byPrimaryRef.has("Text50#0"), false);
  assert.equal(pairing.unmatchedPrimary.length, 1);
}

// --- A rule that cannot fully transfer is dropped whole and reported, never half-written ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([
      { name: "Check Box17", type: "CheckBox", widgets: [{ x: 124, y: 209 }, { x: 167, y: 209 }] },
    ]),
    edition: extraction([{ name: "Chassis", type: "CheckBox", widgets: [{ x: 124, y: 209 }] }]),
    formFieldMappings: {
      chassis: {
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box17",
        options: { STD: { widgetInstanceIndex: 0 }, LTC: { widgetInstanceIndex: 1 } },
      },
    },
  });
  assert.equal(result.formFieldMappings.chassis, undefined);
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0]!.reason, /no counterpart/);
}

// --- Derived mappings and extra simple keys ride the same pairing ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([
      { name: "Text91", widgets: [{ x: 249, y: 531, w: 29, h: 15 }] },
      { name: "Text56", widgets: [{ x: 325, y: 160, w: 112, h: 17 }] },
    ]),
    edition: extraction([
      { name: "Front Spring Rate", widgets: [{ x: 249, y: 530, w: 29, h: 15 }] },
      { name: "Bodyshell", widgets: [{ x: 325, y: 167, w: 111, h: 14 }] },
    ]),
    formFieldMappings: {},
    derivedMappings: { text56: { pdfFieldName: "Text56" } as PdfFormFieldMappingRule },
    extraSimpleKeys: { front_spring_rate_gf_mm: "Text91" },
  });
  assert.deepEqual(result.derivedMappings.text56, { pdfFieldName: "Bodyshell", widgetInstanceIndex: 0 });
  assert.equal(result.extraSimpleKeys.front_spring_rate_gf_mm, "Front Spring Rate");
}

// --- A whole-field multi-widget rule follows only a name-preserving move ---
{
  const together = transferMappingsByGeometry({
    primary: extraction([{ name: "Check Box46", type: "CheckBox", widgets: [{ x: 244, y: 42 }, { x: 269, y: 42 }] }]),
    edition: extraction([{ name: "Winglets", type: "CheckBox", widgets: [{ x: 244, y: 42 }, { x: 269, y: 42 }] }]),
    formFieldMappings: { winglets: { pdfFieldName: "Check Box46" } as PdfFormFieldMappingRule },
  });
  assert.deepEqual(together.formFieldMappings.winglets, { pdfFieldName: "Winglets" });

  const scattered = transferMappingsByGeometry({
    primary: extraction([{ name: "Check Box46", type: "CheckBox", widgets: [{ x: 244, y: 42 }, { x: 269, y: 42 }] }]),
    edition: extraction([
      { name: "Winglet L", type: "CheckBox", widgets: [{ x: 244, y: 42 }] },
      { name: "Winglet R", type: "CheckBox", widgets: [{ x: 269, y: 42 }] },
    ]),
    formFieldMappings: { winglets: { pdfFieldName: "Check Box46" } as PdfFormFieldMappingRule },
  });
  assert.equal(scattered.formFieldMappings.winglets, undefined);
  assert.match(scattered.dropped[0]!.reason, /scatter/);
}

// --- New boxes on the edition surface in the report ---
{
  const result = transferMappingsByGeometry({
    primary: extraction([{ name: "Text1", widgets: [{ x: 47, y: 778 }] }]),
    edition: extraction([
      { name: "Name", widgets: [{ x: 47, y: 780 }] },
      { name: "BW7", type: "CheckBox", widgets: [{ x: 160, y: 249, w: 12, h: 11 }] },
    ]),
    formFieldMappings: { name: { pdfFieldName: "Text1" } as PdfFormFieldMappingRule },
  });
  assert.deepEqual(result.unmatchedEditionWidgets.map((w) => w.fieldName), ["BW7"]);
}

console.log("alignEditionByGeometry.test.ts: all assertions passed");
