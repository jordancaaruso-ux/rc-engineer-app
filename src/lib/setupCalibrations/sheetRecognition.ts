import {
  type PdfFormFieldMappingRule,
  type SetupSheetCalibrationData,
} from "@/lib/setupCalibrations/types";

/**
 * "Is this the sheet the calibration was drawn for?" — measured, not guessed.
 *
 * ============================ WHY THIS EXISTS ============================
 *
 * A calibration rule names its box by exact AcroForm field name: `camber_front` lives in the box
 * called `Text12`. That is fine until a driver turns up with a REBUILT edition of the same sheet —
 * same car, same layout, same boxes, but somebody relabelled every one of them (`Text12` became
 * `Front Camber`). Every rule then misses, and the import reports the same
 * `COMPLETED_WITH_WARNINGS` it reports for a sheet that read perfectly.
 *
 * Measured on production, 2026-08-16, both files against calibration `A800RR_New_V1.0`:
 *
 *   | file                              | rule names present in the PDF | keys imported |
 *   |-----------------------------------|-------------------------------|---------------|
 *   | A800RR_MaxMächler_ECTest…          | most of 134                   | 141           |
 *   | A800RR_Lucas Urbain_Test Andernach | 2 of 134 (`spur`, `pinion`)   | 2             |
 *
 * The second driver logged eighteen runs across a full test day on top of a six-field setup, and
 * nothing anywhere told him. Two of 119 rules is not a partial read — it is a different sheet — and
 * the two must not end in the same place.
 *
 * ==================== WHY NAME PRESENCE, NOT VALUES READ ====================
 *
 * The obvious signal — how many keys came back with a value — is WRONG, and quietly so. A driver
 * who fills in eight boxes of a sheet they have only started has a perfectly recognised sheet and
 * a tiny value count; refusing that would break the most ordinary upload there is.
 *
 * What separates the two cases is whether the BOXES THE CALIBRATION NAMES EXIST IN THE FILE AT ALL,
 * which is true of a blank sheet and false of a foreign one. So this counts names, and never looks
 * at a value.
 */

/** How many of the calibration's named boxes actually exist in the uploaded PDF. */
export type SheetNamePresence = {
  /** Distinct AcroForm field names the calibration's form rules refer to. */
  referenced: number;
  /** How many of those names exist in this PDF. */
  present: number;
  /** `present / referenced`, or 1 when the calibration names no boxes (nothing to miss). */
  ratio: number;
};

/**
 * Below this share of its named boxes, a calibration is reading a sheet it was not drawn for.
 *
 * A correctly matched sheet sits near 1.0 by construction: the names come from the same template
 * file, so a filled copy carries the same ones. Half is therefore a long way below anything
 * legitimate, while still leaving room for an edition that dropped or renamed a handful of boxes
 * between revisions — those should still import, with the misses visible as empty boxes on the
 * sheet picture, which is the standard set on 2026-08-11.
 */
export const SHEET_RECOGNISED_MIN_NAME_RATIO = 0.5;

/**
 * Below this many named boxes the ratio is noise, so the check abstains.
 *
 * Mirrors `minNameCount` in `autoPickCalibration.ts` for the same reason: a calibration with a
 * handful of rules cannot distinguish a foreign sheet from a coincidence, and a wrong refusal is
 * worse than a missing one — the driver has a file that works and is being told it does not.
 */
export const SHEET_RECOGNISED_MIN_RULES = 8;

/** Walk a rule and collect every AcroForm field name it can refer to, including option widgets. */
function collectRuleFieldNames(rule: unknown, out: Set<string>): void {
  if (!rule || typeof rule !== "object") return;
  const r = rule as Record<string, unknown>;
  if (typeof r.pdfFieldName === "string" && r.pdfFieldName.trim()) out.add(r.pdfFieldName);
  // Choice/multi-select rules carry their real field names one level down, per option or widget.
  for (const key of ["options", "widgets", "fields", "namedFields"] as const) {
    const nested = r[key];
    if (Array.isArray(nested)) {
      for (const entry of nested) collectRuleFieldNames(entry, out);
    } else if (nested && typeof nested === "object") {
      for (const entry of Object.values(nested)) collectRuleFieldNames(entry, out);
    }
  }
}

/** Every distinct AcroForm field name this calibration's form rules look for. */
export function referencedPdfFieldNames(
  formFieldMappings: Record<string, PdfFormFieldMappingRule> | undefined
): Set<string> {
  const out = new Set<string>();
  for (const rule of Object.values(formFieldMappings ?? {})) collectRuleFieldNames(rule, out);
  return out;
}

/** Measure how much of the calibration's vocabulary this PDF actually speaks. */
export function measureSheetNamePresence(input: {
  calibrationData: Pick<SetupSheetCalibrationData, "formFieldMappings">;
  pdfFieldNames: readonly string[];
}): SheetNamePresence {
  const referenced = referencedPdfFieldNames(input.calibrationData.formFieldMappings);
  if (referenced.size === 0) return { referenced: 0, present: 0, ratio: 1 };
  const present = new Set(input.pdfFieldNames);
  let hits = 0;
  for (const name of referenced) if (present.has(name)) hits += 1;
  return { referenced: referenced.size, present: hits, ratio: hits / referenced.size };
}

/**
 * True when the calibration and the file are describing different sheets.
 *
 * Abstains (returns false) when the calibration names too few boxes to judge — see
 * {@link SHEET_RECOGNISED_MIN_RULES}. Abstaining means "carry on as before", so a calibration this
 * check cannot assess is never made worse by it.
 */
export function isUnrecognisedSheet(presence: SheetNamePresence): boolean {
  if (presence.referenced < SHEET_RECOGNISED_MIN_RULES) return false;
  return presence.ratio < SHEET_RECOGNISED_MIN_NAME_RATIO;
}

/** What the driver is told, naming the file and the number rather than saying "warnings". */
export function unrecognisedSheetMessage(input: {
  presence: SheetNamePresence;
  calibrationName?: string | null;
}): string {
  const { present, referenced } = input.presence;
  const which = input.calibrationName ? `the ${input.calibrationName} layout` : "the layout we know";
  return (
    `This is a setup sheet we don't recognise — only ${present} of the ${referenced} boxes in ` +
    `${which} are in your file, so importing it would fill in almost nothing. It looks like a ` +
    `rebuilt version of the sheet with the boxes renamed. Add it as its own sheet and you'll get ` +
    `every box on it.`
  );
}
