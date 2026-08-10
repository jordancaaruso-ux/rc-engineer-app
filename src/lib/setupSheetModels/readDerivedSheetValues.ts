import type { PdfFormFieldEntry, PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSnapshotData } from "@/lib/runSetup";

/**
 * Read the values a driver typed into their own sheet, for a sheet the app derived from that same
 * file.
 *
 * ======================= WHY THIS DOES NOT REUSE THE IMPORT PATH =======================
 *
 * `applyPdfFormFieldMappingsFromExtraction` exists and does a superficially identical job. It must
 * not be used here, and the reason is specific rather than stylistic.
 *
 * That path finishes every value through `finalizeAwesomatixStringImport`, which calls
 * `rewriteImportedCalculatedDisplayKey` (`src/lib/setup/derivedFields.ts`). That function hard-codes
 * two box names:
 *
 *     if (k.toLowerCase() === "text91") return IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY;
 *     if (k.toLowerCase() === "text93") return IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY;
 *
 * A sheet whose fields are Acrobat defaults derives keys in exactly that namespace — the whole
 * Mugen MTC3 is `text2` … `text142`. So a driver's box 91 would be renamed into an Awesomatix
 * spring-rate key, which is not in their sheet's schema. The value would vanish from their sheet
 * with no error shown, and reappear under a label meaning something else entirely.
 * `rewriteImportedSpringRateKey` does the same to any key that merely LOOKS like a spring rate,
 * which the Xray sheets have.
 *
 * Measured 2026-08-10 across all four repo fixtures: **zero keys are hit today**, purely because
 * Mugen's numbering happens to skip 91 and 93. It is a live trap rather than a live bug, and it is
 * one manufacturer sheet away from firing.
 *
 * The deeper point is structural, and it is Jordan's ruling of 2026-08-10 expressed in code: a
 * derived sheet has no canonical keys, so no canonical-key machinery may touch it. That rules out
 * `canonicalSetupFieldKey`, the Awesomatix sanitizers, the calculated-display rewrites and the
 * template value normalizer, all at once. What is left is small enough to read in one sitting,
 * which is the point.
 */

/** How a ticked box is stored, matching `SheetFillSurface` and the image pipeline. */
const TICKED = "1";

/**
 * `extractPdfFormFields` overwrites `value` with a human-readable summary for a field whose several
 * widgets each toggle independently — `"on: #0, #2"`, or `"all off"` when none are.
 *
 * That string is a debugging aid, never a value. It is why Xray's blank appears to carry 45 values
 * when in truth it carries none. Recognised explicitly so it can never reach a driver's sheet.
 */
function isWidgetStateSummary(value: string): boolean {
  return value === "all off" || /^on: #\d/.test(value);
}

/** Checkbox and radio fields report a boolean; text and dropdown fields report null. */
function isToggleField(entry: PdfFormFieldEntry): boolean {
  return entry.booleanValue !== null && entry.booleanValue !== undefined;
}

/**
 * A row of tick boxes sharing one name, where the PDF also declared what each box means.
 *
 * The same test `deriveSchemaFromAcroForm` used when it decided to mint ONE parameter for the row
 * rather than one per box. The two must agree, or the mapping and the reader would disagree about
 * how many parameters the row is.
 */
function choiceOptionsFor(entry: PdfFormFieldEntry): string[] | null {
  if (!isToggleField(entry) || entry.widgets.length <= 1) return null;
  const options = entry.options ?? [];
  return options.length >= entry.widgets.length ? options : null;
}

function readOneValue(entry: PdfFormFieldEntry, widgetInstanceIndex: number | undefined): string {
  // One box out of a row that shares a name.
  if (widgetInstanceIndex !== undefined) {
    const widget = entry.widgets.find((w) => w.instanceIndex === widgetInstanceIndex);
    if (!widget) return "";
    if (isToggleField(entry)) return widget.checked ? TICKED : "";
    // A text field drawn in several places holds ONE value that every widget renders. Repeating it
    // per box is what the paper actually shows.
    return isWidgetStateSummary(entry.value) ? "" : entry.value.trim();
  }

  // A row of ticks the PDF labelled: report which label is ticked.
  const options = choiceOptionsFor(entry);
  if (options) {
    const ticked = entry.widgets.find((w) => w.checked);
    if (!ticked) return "";
    return (options[ticked.instanceIndex] ?? "").trim();
  }

  // A lone tick box.
  if (isToggleField(entry)) return entry.booleanValue === true ? TICKED : "";

  // Text, dropdown, option list.
  return isWidgetStateSummary(entry.value) ? "" : entry.value.trim();
}

/**
 * Values only. The keys come from the mappings, which came from the same derivation as the sheet
 * the driver will be looking at — so every key here is one their sheet declares.
 *
 * Empty boxes are left unset rather than stored as "", so a sheet the driver has not finished does
 * not look like a sheet full of deliberate blanks.
 */
export function readDerivedSheetValues(input: {
  extraction: PdfFormFieldsExtraction;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
}): { values: SetupSnapshotData; filledCount: number } {
  const byName = new Map<string, PdfFormFieldEntry>();
  for (const entry of input.extraction.fields) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }

  const values: SetupSnapshotData = {};
  let filledCount = 0;

  for (const [key, rule] of Object.entries(input.formFieldMappings)) {
    if (!rule || typeof rule !== "object") continue;
    // Derived mappings are always the simple shape. Anything else is not this sheet's and is
    // skipped rather than guessed at.
    if ("mode" in rule && rule.mode && rule.mode !== "acroField") continue;
    if (!("pdfFieldName" in rule) || !rule.pdfFieldName) continue;

    const entry = byName.get(rule.pdfFieldName);
    if (!entry) continue;

    const widgetInstanceIndex =
      "widgetInstanceIndex" in rule && typeof rule.widgetInstanceIndex === "number"
        ? rule.widgetInstanceIndex
        : undefined;

    const value = readOneValue(entry, widgetInstanceIndex);
    if (!value) continue;
    values[key] = value;
    filledCount += 1;
  }

  return { values, filledCount };
}
