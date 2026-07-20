import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";

import {
  parseBlankAcroFormGeometry,
  widgetInstanceIndexByGeometryIndex,
  type BlankWidgetGeometry,
} from "@/lib/setupExtractAi/draftCalibrationFromBlankSheet";

/**
 * The blank-sheet drafter reads widgets in raw pdf-lib `getWidgets()` order, but the PDF *reader*
 * (setupDocuments/pdfFormFields.ts `collectWidgetLayouts`) re-sorts them by (page, y, x) and
 * renumbers 0..n-1. Emitting raw indices in a calibration maps every checkbox option to the wrong
 * box — values land under the wrong parameter instead of failing loudly.
 */

const w = (widgetIndex: number, yPct: number, xPct: number): BlankWidgetGeometry => ({
  widgetIndex,
  region: { xPct, yPct, wPct: 0.02, hPct: 0.02 },
});

test("already-visual-order widgets map to themselves", () => {
  const m = widgetInstanceIndexByGeometryIndex([w(0, 0.1, 0.1), w(1, 0.2, 0.1), w(2, 0.3, 0.1)]);
  assert.deepEqual([m.get(0), m.get(1), m.get(2)], [0, 1, 2]);
});

test("scrambled creation order is renumbered top-to-bottom", () => {
  // Widgets authored bottom-up: geometry index 0 is visually LAST.
  const m = widgetInstanceIndexByGeometryIndex([w(0, 0.9, 0.1), w(1, 0.5, 0.1), w(2, 0.1, 0.1)]);
  assert.equal(m.get(2), 0, "topmost box is instance 0");
  assert.equal(m.get(1), 1);
  assert.equal(m.get(0), 2, "bottom box is instance 2");
});

test("widgets on one row are ordered left-to-right", () => {
  const m = widgetInstanceIndexByGeometryIndex([w(0, 0.4, 0.8), w(1, 0.4, 0.2), w(2, 0.4, 0.5)]);
  assert.deepEqual([m.get(1), m.get(2), m.get(0)], [0, 1, 2]);
});

test("row beats column: lower y wins even when x is further right", () => {
  const m = widgetInstanceIndexByGeometryIndex([w(0, 0.6, 0.1), w(1, 0.2, 0.9)]);
  assert.equal(m.get(1), 0);
  assert.equal(m.get(0), 1);
});

test("every geometry index gets exactly one distinct instance index", () => {
  const widgets = [w(0, 0.5, 0.5), w(1, 0.5, 0.1), w(2, 0.1, 0.9), w(3, 0.9, 0.2)];
  const m = widgetInstanceIndexByGeometryIndex(widgets);
  assert.equal(m.size, widgets.length);
  assert.deepEqual([...m.values()].sort(), [0, 1, 2, 3]);
});

test("real AcroForm: scrambled widget creation order is corrected by geometry", async () => {
  // Build a one-page PDF whose checkbox widgets are added bottom-to-top, i.e. raw getWidgets()
  // order is the reverse of visual order — exactly the case that silently mis-maps options.
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const box = doc.getForm().createCheckBox("surface");
  // y in pdf-lib is bottom-left origin, so a SMALL y is visually near the BOTTOM.
  box.addToPage(page, { x: 50, y: 100, width: 12, height: 12 });
  box.addToPage(page, { x: 50, y: 400, width: 12, height: 12 });
  box.addToPage(page, { x: 50, y: 700, width: 12, height: 12 });

  const geometry = await parseBlankAcroFormGeometry(Buffer.from(await doc.save()));
  const field = geometry.fields.find((f) => f.name === "surface");
  assert.ok(field, "checkbox field parsed");
  assert.equal(field.widgets.length, 3);
  assert.equal(geometry.pageCount, 1);

  const m = widgetInstanceIndexByGeometryIndex(field.widgets);
  // Creation index 2 (pdf y=700) is the topmost box → reader instance 0.
  assert.equal(m.get(2), 0);
  assert.equal(m.get(1), 1);
  assert.equal(m.get(0), 2);
});
