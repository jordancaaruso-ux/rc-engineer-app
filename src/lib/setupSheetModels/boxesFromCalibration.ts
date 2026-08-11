import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type {
  PdfFormFieldEntry,
  PdfFormFieldsExtraction,
  PdfFormFieldWidgetRect,
} from "@/lib/setupDocuments/pdfFormFields";
import { DEFAULT_PDF_FIELD_APPEARANCE } from "@/lib/setupDocuments/pdfFieldAppearance";
import type { DerivedBox } from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Box geometry for a chassis that was calibrated BEFORE sheets-as-pictures existed.
 *
 * ============================== THE PROBLEM THIS SOLVES ==============================
 *
 * A chassis born from a driver's PDF gets its boxes at upload: the derivation reads the form layer
 * and mints a parameter per box. A curated chassis (the Awesomatix A800RR) went the other way —
 * its parameters were authored by hand, and a CALIBRATION says which printed box each one lives
 * in. Such a chassis has everything the sheet surface needs, in the wrong shape.
 *
 * Running the derivation on its PDF would be catastrophic: the derivation MINTS KEYS from the
 * PDF's own field names, and this chassis's keys are already fixed — two seasons of setups and
 * runs point at `camber_front`, not at `Texte2`. So this module goes the other way around: it
 * walks the calibration's `formFieldMappings` — whose left-hand side IS the schema key — and asks
 * the PDF only for geometry. No key is invented anywhere; a box can only ever be called what the
 * calibration already calls it.
 *
 * ============================== GROUPED PARAMETERS ==============================
 *
 * A one-of-many row prints as several tick boxes. Each becomes its own box carrying the SAME key
 * plus the option it stands for — see `DerivedBox.optionValue`. The option value written on the
 * box is the SCHEMA's canonical one (matched case-insensitively against the calibration's),
 * because stored setups hold the schema's casing and the surface compares box against stored
 * value. A calibration option the schema doesn't know keeps its own casing rather than being
 * dropped: geometry a driver can see beats an unmatchable box.
 *
 * Pure: PDF extraction in, boxes out. The caller owns storage.
 */

export type BoxesFromCalibrationResult = {
  boxes: DerivedBox[];
  /** Schema keys whose rule pointed at a PDF field this file doesn't have. */
  unresolvedKeys: string[];
  /** Mapped keys the schema doesn't declare (header boxes: date, track…). Skipped, listed. */
  skippedCalibrationOnlyKeys: string[];
};

function boxFor(
  key: string,
  entry: PdfFormFieldEntry,
  widget: PdfFormFieldWidgetRect,
  optionValue?: string
): DerivedBox {
  const a = entry.appearance ?? DEFAULT_PDF_FIELD_APPEARANCE;
  return {
    key,
    pageNumber: widget.pageNumber,
    x: widget.x / widget.pageWidth,
    y: widget.y / widget.pageHeight,
    width: widget.width / widget.pageWidth,
    height: widget.height / widget.pageHeight,
    style: {
      fontFamily: a.fontFamily,
      bold: a.bold,
      italic: a.italic,
      color: a.color,
      alignment: a.alignment,
      fontSizeFrac: a.fontSize > 0 ? a.fontSize / widget.pageHeight : 0,
      ...(widget.checkMark ? { checkMark: widget.checkMark } : {}),
    },
    ...(optionValue !== undefined ? { optionValue } : {}),
  };
}

function normToken(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The schema's own casing for this option, so boxes compare cleanly against stored setups. */
function canonicalOptionValue(
  field: { groupedOptionValues?: string[]; groupedOptionLabels?: string[] } | undefined,
  calibrationValue: string
): string {
  const target = normToken(calibrationValue);
  for (const list of [field?.groupedOptionValues, field?.groupedOptionLabels]) {
    for (const v of list ?? []) {
      if (normToken(v) === target) {
        // Prefer the VALUE at the label's index when only the label matched.
        if (list === field?.groupedOptionLabels && field?.groupedOptionValues?.length) {
          const i = field.groupedOptionLabels!.indexOf(v);
          const value = field.groupedOptionValues[i];
          if (value) return value;
        }
        return v;
      }
    }
  }
  return calibrationValue;
}

export function boxesFromCalibrationMappings(input: {
  extraction: PdfFormFieldsExtraction;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  schema: Pick<SetupSheetModelSchema, "fields">;
  /**
   * Boxes the calibration never needed but the paper prints: keys the import path COMPUTES
   * (Awesomatix spring rate, final drive ratio) still have a printed box a driver reads, and a
   * sheet without them would show their row empty forever. Key → PDF field name.
   */
  extraSimpleKeys?: Record<string, string>;
}): BoxesFromCalibrationResult {
  const byName = new Map(input.extraction.fields.map((f) => [f.name, f] as const));
  const fieldByKey = new Map(input.schema.fields.map((f) => [f.key, f] as const));

  const boxes: DerivedBox[] = [];
  const unresolvedKeys: string[] = [];
  const skippedCalibrationOnlyKeys: string[] = [];

  for (const [key, rule] of Object.entries(input.formFieldMappings)) {
    const schemaField = fieldByKey.get(key);
    if (!schemaField) {
      skippedCalibrationOnlyKeys.push(key);
      continue;
    }

    const r = rule as {
      mode?: string;
      pdfFieldName?: string;
      widgetInstanceIndex?: number;
      options?: Record<string, { pdfFieldName?: string; widgetInstanceIndex?: number }>;
    };

    if (r.mode === "singleChoiceWidgetGroup" || r.mode === "multiSelectWidgetGroup") {
      const entry = byName.get(r.pdfFieldName ?? "");
      if (!entry) {
        unresolvedKeys.push(key);
        continue;
      }
      let missed = false;
      for (const [optionValue, ref] of Object.entries(r.options ?? {})) {
        const widget = entry.widgets[ref.widgetInstanceIndex ?? 0];
        if (!widget) {
          missed = true;
          continue;
        }
        boxes.push(boxFor(key, entry, widget, canonicalOptionValue(schemaField, optionValue)));
      }
      if (missed) unresolvedKeys.push(key);
      continue;
    }

    if (r.mode === "singleChoiceNamedFields" || r.mode === "multiSelectNamedFields") {
      let missed = false;
      for (const [optionValue, ref] of Object.entries(r.options ?? {})) {
        const entry = byName.get(ref.pdfFieldName ?? "");
        const widget = entry?.widgets[ref.widgetInstanceIndex ?? 0];
        if (!entry || !widget) {
          missed = true;
          continue;
        }
        /*
         * An "option" whose PDF field is a TEXT LINE is the paper's own free-text choice — the
         * Awesomatix bumper row is two tick boxes and a line you write on. Writing on the line IS
         * choosing "other", so the line belongs to the `_other` companion parameter as a text box,
         * not to the choice as a tick that could never be ticked. Only diverted when the companion
         * exists and has no box of its own; otherwise the geometry stays here rather than vanish.
         */
        const companionKey = `${key}_other`;
        if (
          entry.type === "Text" &&
          fieldByKey.has(companionKey) &&
          !input.formFieldMappings[companionKey]
        ) {
          boxes.push(boxFor(companionKey, entry, widget));
          continue;
        }
        boxes.push(boxFor(key, entry, widget, canonicalOptionValue(schemaField, optionValue)));
      }
      if (missed) unresolvedKeys.push(key);
      continue;
    }

    if (r.pdfFieldName) {
      const entry = byName.get(r.pdfFieldName);
      const widget = entry?.widgets[r.widgetInstanceIndex ?? 0];
      if (!entry || !widget) {
        unresolvedKeys.push(key);
        continue;
      }
      boxes.push(boxFor(key, entry, widget));
    }
  }

  for (const [key, pdfFieldName] of Object.entries(input.extraSimpleKeys ?? {})) {
    if (!fieldByKey.has(key)) {
      skippedCalibrationOnlyKeys.push(key);
      continue;
    }
    // A key the calibration also maps keeps the calibration's box — these are supplements only.
    if (boxes.some((b) => b.key === key)) continue;
    const entry = byName.get(pdfFieldName);
    const widget = entry?.widgets[0];
    if (!entry || !widget) {
      unresolvedKeys.push(key);
      continue;
    }
    boxes.push(boxFor(key, entry, widget));
  }

  return { boxes, unresolvedKeys, skippedCalibrationOnlyKeys };
}
