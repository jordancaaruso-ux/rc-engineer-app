import assert from "node:assert/strict";
import test from "node:test";

import { flattenFillMappings } from "@/lib/setup/fillMappingFromCalibration";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";

const rule = (r: unknown) => r as PdfFormFieldMappingRule;

test("a plain box carries the driver's value straight through", () => {
  const flat = flattenFillMappings({
    formFieldMappings: { camber_front: rule({ pdfFieldName: "Texte2" }) },
    surfaceValues: { camber_front: "-1.5" },
  });
  assert.deepEqual(flat.mappings, { camber_front: { pdfFieldName: "Texte2" } });
  assert.deepEqual(flat.values, { camber_front: "-1.5" });
});

test("an empty box is still addressed, so clearing a value clears the paper", () => {
  const flat = flattenFillMappings({
    formFieldMappings: { camber_front: rule({ pdfFieldName: "Texte2" }) },
    surfaceValues: {},
  });
  assert.deepEqual(flat.values, { camber_front: "" });
});

/**
 * The whole reason this module exists: a calibration's grouped rule says "the answer is WHICH box is
 * ticked", and `fillPdfForm` only understands "put this in that box".
 */
test("a one-of-many row ticks only the box the driver chose", () => {
  const flat = flattenFillMappings({
    formFieldMappings: {
      diff_height_front: rule({
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box6",
        options: {
          low: { widgetInstanceIndex: 0 },
          mid: { widgetInstanceIndex: 1 },
          high: { widgetInstanceIndex: 2 },
        },
      }),
    },
    surfaceValues: { diff_height_front: "mid" },
  });
  assert.deepEqual(flat.mappings, {
    "diff_height_front::mid": { pdfFieldName: "Check Box6", widgetInstanceIndex: 1 },
  });
  assert.deepEqual(flat.values, { "diff_height_front::mid": "1" });
});

/** Stored setups hold the schema's casing; a calibration may hold its own. Same box either way. */
test("the option match ignores case and spacing", () => {
  const flat = flattenFillMappings({
    formFieldMappings: {
      fr_upper_arm: rule({
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Arm",
        options: { "Links short": { widgetInstanceIndex: 1 } },
      }),
    },
    surfaceValues: { fr_upper_arm: "links  short" },
  });
  assert.deepEqual(Object.keys(flat.mappings), ["fr_upper_arm::Links short"]);
});

test("nothing is emitted for a row the driver never answered", () => {
  const flat = flattenFillMappings({
    formFieldMappings: {
      diff_height_front: rule({
        mode: "singleChoiceWidgetGroup",
        pdfFieldName: "Check Box6",
        options: { low: { widgetInstanceIndex: 0 } },
      }),
    },
    surfaceValues: {},
  });
  assert.deepEqual(flat.mappings, {});
});

test("a many-of-many row ticks every option the driver selected", () => {
  const flat = flattenFillMappings({
    formFieldMappings: {
      top_deck_cuts: rule({
        mode: "multiSelectNamedFields",
        options: {
          front: { pdfFieldName: "CutFront" },
          middle: { pdfFieldName: "CutMid" },
          rear: { pdfFieldName: "CutRear" },
        },
      }),
    },
    surfaceValues: { top_deck_cuts: "front, rear" },
  });
  assert.deepEqual(Object.keys(flat.mappings).sort(), [
    "top_deck_cuts::front",
    "top_deck_cuts::rear",
  ]);
  assert.deepEqual(flat.mappings["top_deck_cuts::rear"], { pdfFieldName: "CutRear" });
});

/**
 * A single-select must not behave like a multi-select: "front, rear" typed into a pick-one row is
 * one string, not two answers, and ticking both boxes would claim the driver chose something they
 * did not.
 */
test("a comma in a pick-one value is text, not two answers", () => {
  const flat = flattenFillMappings({
    formFieldMappings: {
      bumper: rule({
        mode: "singleChoiceNamedFields",
        options: { soft: { pdfFieldName: "Soft" }, hard: { pdfFieldName: "Hard" } },
      }),
    },
    surfaceValues: { bumper: "soft, hard" },
  });
  assert.deepEqual(flat.mappings, {});
});

test("a rule with no PDF field is dropped rather than addressing nothing", () => {
  const flat = flattenFillMappings({
    formFieldMappings: { orphan: rule({ pdfFieldName: "" }) },
    surfaceValues: { orphan: "3" },
  });
  assert.deepEqual(flat.mappings, {});
});
