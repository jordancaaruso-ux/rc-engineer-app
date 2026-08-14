import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { PdfFillMapping } from "@/lib/setupDocuments/fillPdfForm";
import { optionSelectedInSurfaceValue } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * Flatten a chassis's mapping rules and a driver's setup into the one-box-one-value pairs
 * `fillPdfForm` writes onto the manufacturer's blank.
 *
 * ============================== WHY A TRANSLATION IS NEEDED ==============================
 *
 * `fillPdfForm` addresses a single box: a PDF field name and, when the field owns several, which
 * one. That is exactly the shape a derived mapping has, and exactly what a calibration's
 * `acroField` rule has. It is NOT what a calibration's four grouped shapes have — those say "this
 * parameter's answer is *which* of these boxes is ticked", which is a decision, not an address.
 *
 * So a grouped row is resolved here, against the driver's actual value: the option that matches
 * becomes one synthetic entry addressing its own box with a tick, and the options that don't match
 * are simply not emitted. An untouched box is left as the blank drew it rather than actively
 * unticked, which is the same thing on paper and one less way to damage the file.
 *
 * The synthetic key is only ever a handle for `fillPdfForm`'s bookkeeping — it never reaches a
 * driver, a snapshot or a schema. `::` cannot appear in a schema key, so it cannot collide with one.
 *
 * ============================== WHAT IT DELIBERATELY DOES NOT DO ==============================
 *
 * It does not decide whether a value is *right*, convert units, or apply any convention. Everything
 * here has already been through `storedValuesToSurface`, which is the same bridge the on-screen
 * sheet uses — so what a driver sees in a box and what lands in the exported PDF come from one
 * source. If those two ever disagree, one of them is wrong about the sheet, and that is worth
 * knowing rather than papering over.
 */

/** Separates a grouped parameter's key from the option it stands for. Internal to the fill. */
const OPTION_KEY_SEPARATOR = "::";

export type FlatFill = {
  mappings: Record<string, PdfFillMapping>;
  /** Index-matched to `mappings`: what to write in that box. A tick is `"1"`. */
  values: Record<string, string>;
};

/** How a ticked box is stored, matching `SheetFillSurface` and `readDerivedSheetValues`. */
const TICKED = "1";

export function flattenFillMappings(input: {
  /** Schema key -> rule. Calibration rules, derived rules, or both merged. */
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  /** Schema key -> the string the sheet surface would draw. See `storedValuesToSurface`. */
  surfaceValues: Record<string, string>;
}): FlatFill {
  const mappings: Record<string, PdfFillMapping> = {};
  const values: Record<string, string> = {};

  const emit = (key: string, mapping: PdfFillMapping, value: string) => {
    if (!mapping.pdfFieldName) return;
    mappings[key] = mapping;
    values[key] = value;
  };

  for (const [key, rule] of Object.entries(input.formFieldMappings)) {
    if (!rule || typeof rule !== "object") continue;
    const r = rule as {
      mode?: string;
      pdfFieldName?: string;
      widgetInstanceIndex?: number;
      options?: Record<string, { pdfFieldName?: string; widgetInstanceIndex?: number }>;
    };
    const surfaceValue = input.surfaceValues[key] ?? "";

    if (r.mode === "singleChoiceWidgetGroup" || r.mode === "multiSelectWidgetGroup") {
      const multi = r.mode === "multiSelectWidgetGroup";
      for (const [optionValue, ref] of Object.entries(r.options ?? {})) {
        if (!optionSelectedInSurfaceValue(surfaceValue, optionValue, multi)) continue;
        emit(
          `${key}${OPTION_KEY_SEPARATOR}${optionValue}`,
          { pdfFieldName: r.pdfFieldName ?? "", widgetInstanceIndex: ref.widgetInstanceIndex ?? 0 },
          TICKED
        );
      }
      continue;
    }

    if (r.mode === "singleChoiceNamedFields" || r.mode === "multiSelectNamedFields") {
      const multi = r.mode === "multiSelectNamedFields";
      for (const [optionValue, ref] of Object.entries(r.options ?? {})) {
        if (!optionSelectedInSurfaceValue(surfaceValue, optionValue, multi)) continue;
        emit(
          `${key}${OPTION_KEY_SEPARATOR}${optionValue}`,
          {
            pdfFieldName: ref.pdfFieldName ?? "",
            ...(ref.widgetInstanceIndex === undefined
              ? {}
              : { widgetInstanceIndex: ref.widgetInstanceIndex }),
          },
          TICKED
        );
      }
      continue;
    }

    // A plain box: text, dropdown, or a lone tick.
    if (!r.pdfFieldName) continue;
    emit(
      key,
      {
        pdfFieldName: r.pdfFieldName,
        ...(r.widgetInstanceIndex === undefined ? {} : { widgetInstanceIndex: r.widgetInstanceIndex }),
      },
      surfaceValue
    );
  }

  return { mappings, values };
}
