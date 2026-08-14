import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import {
  deriveSchemaFromAcroForm,
  type DerivedBox,
  type DerivedSheetStats,
  type WidgetRef,
} from "@/lib/setupSheetModels/deriveSchemaFromAcroForm";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

/**
 * Every printed box on a CALIBRATED chassis gets a key, a box and a mapping — not just the ones a
 * human named.
 *
 * ============================== THE PROBLEM THIS SOLVES ==============================
 *
 * A chassis born from a driver's blank runs `deriveSchemaFromAcroForm`, which is total: one
 * parameter per widget, always. A curated chassis (the Awesomatix A800RR) went the other way — its
 * parameters were authored by hand and a calibration says which printed box each one sits in. That
 * calibration covers the boxes worth *understanding*, which is far fewer than the boxes the sheet
 * *prints*. Everything it doesn't name had nowhere to live: the value was read off an uploaded PDF
 * and dropped, the box didn't draw on screen, and an export left it blank.
 *
 * That was fine while the sheet was a thing the app re-created from named parameters. It stopped
 * being fine when the sheet picture became the surface drivers read and edit setups on: a printed
 * box with no key is a box the driver can see and cannot touch.
 *
 * ============================ UNION, NOT REPLACE ============================
 *
 * Running the plain derivation over such a chassis would be catastrophic — it MINTS KEYS from the
 * PDF's field names, and this chassis's keys are already fixed. Two seasons of setups point at
 * `camber_front`, not at `Texte2`. So the calibration keeps every key it owns and this pass fills
 * in around it:
 *
 *  - boxes the calibration already claims are excluded, so no printed box gets two parameters;
 *  - every existing schema key is reserved before minting starts, so no derived key can land on one.
 *
 * What comes back is additive. Nothing here renames, re-points or removes an existing parameter.
 *
 * ======================== WHY THE MAPPINGS GO SOMEWHERE ELSE ========================
 *
 * The derived mappings deliberately do NOT belong in the calibration's `formFieldMappings`, even
 * though they are the same shape. Values read through that map are finished by
 * `finalizeAwesomatixStringImport`, whose `rewriteImportedCalculatedDisplayKey` hard-codes `text91`
 * and `text93` onto Awesomatix spring-rate keys — and derived keys live in exactly that namespace on
 * any sheet whose fields are Acrobat defaults. See the header of `readDerivedSheetValues.ts`: a
 * derived sheet has no canonical keys, so no canonical-key machinery may touch it. The caller stores
 * these on `SetupSheetBlank.derivedMappingsJson` and reads them with `readDerivedSheetValues`.
 *
 * Pure: extraction + schema + mappings in, additions out. The caller owns storage.
 */

export type UnionResult = {
  /** Parameters to APPEND to the model schema. Never replaces an existing one. */
  fields: SetupSheetModelFieldDef[];
  /** Geometry for those parameters, to merge into `SetupSheetBlank.boxesJson`. */
  boxes: DerivedBox[];
  /** Schema key -> where it sits on this blank. Stored apart from the calibration — see above. */
  mappings: Record<string, PdfFormFieldMappingRule>;
  /** Boxes the calibration already owns, so a run can report coverage honestly. */
  claimedWidgetCount: number;
  stats: DerivedSheetStats;
};

/**
 * Which boxes a calibration already speaks for, across all five mapping shapes.
 *
 * A rule with no `widgetInstanceIndex` claims the WHOLE field — that is what `acroField` means when
 * it omits one, and reading it as "widget 0 only" would leave the siblings of a multi-widget text
 * field derivable, so the same printed value would appear twice under two different keys.
 */
export function claimedWidgetsFromMappings(
  formFieldMappings: Record<string, PdfFormFieldMappingRule>,
  extraSimpleKeys?: Record<string, string>
): WidgetRef[] {
  const out: WidgetRef[] = [];
  const push = (pdfFieldName: string | undefined, widgetInstanceIndex?: number) => {
    if (!pdfFieldName) return;
    out.push(widgetInstanceIndex === undefined ? { pdfFieldName } : { pdfFieldName, widgetInstanceIndex });
  };

  for (const rule of Object.values(formFieldMappings)) {
    if (!rule || typeof rule !== "object") continue;
    const r = rule as {
      mode?: string;
      pdfFieldName?: string;
      widgetInstanceIndex?: number;
      options?: Record<string, { pdfFieldName?: string; widgetInstanceIndex?: number }>;
    };

    if (r.mode === "singleChoiceWidgetGroup" || r.mode === "multiSelectWidgetGroup") {
      // Every option is a widget of the one named field; the row is one parameter, so take it whole.
      push(r.pdfFieldName);
      continue;
    }
    if (r.mode === "singleChoiceNamedFields" || r.mode === "multiSelectNamedFields") {
      for (const ref of Object.values(r.options ?? {})) push(ref.pdfFieldName, ref.widgetInstanceIndex);
      continue;
    }
    push(r.pdfFieldName, r.widgetInstanceIndex);
  }

  // The hand-written supplements `boxesFromCalibrationMappings` already draws (Awesomatix spring
  // rate, final drive ratio): printed boxes the calibration never needed but the app computes.
  for (const pdfFieldName of Object.values(extraSimpleKeys ?? {})) push(pdfFieldName);

  return out;
}

export function unionDerivedWithCalibration(input: {
  extraction: PdfFormFieldsExtraction;
  schema: Pick<SetupSheetModelSchema, "fields">;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  /** See `boxesFromCalibrationMappings` — key -> PDF field name. */
  extraSimpleKeys?: Record<string, string>;
  /** Only used for the derived schema's own label; the model keeps its name. */
  label: string;
}): UnionResult {
  const claimed = claimedWidgetsFromMappings(input.formFieldMappings, input.extraSimpleKeys);

  const derived = deriveSchemaFromAcroForm(input.extraction, input.label, {
    excludeWidgets: claimed,
    // Both sides: the schema's keys are what history points at, and the mapping table can name a
    // key the schema no longer declares (header boxes — date, track). Reserving both means a
    // derived key can never collide with something that might come back.
    reservedKeys: [
      ...input.schema.fields.map((f) => f.key),
      ...Object.keys(input.formFieldMappings),
      ...Object.keys(input.extraSimpleKeys ?? {}),
    ],
  });

  // The derivation numbers `sortOrder` from 1 because it normally builds a whole sheet. Appended
  // onto an authored chassis those numbers already belong to named parameters, and the ordinary
  // form sorts on them — so the unnamed boxes would interleave themselves through the driver's own
  // parameters. Push them past the end instead; on the sheet surface order is geometry, not this.
  const sortBase = input.schema.fields.reduce((m, f) => Math.max(m, f.sortOrder ?? 0), 0);

  return {
    fields: derived.schema.fields.map((f) => ({ ...f, sortOrder: sortBase + (f.sortOrder ?? 0) })),
    boxes: derived.boxes,
    mappings: derived.formFieldMappings,
    claimedWidgetCount: claimed.length,
    stats: derived.stats,
  };
}
