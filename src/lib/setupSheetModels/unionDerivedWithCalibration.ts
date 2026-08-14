import { inferUiTypeFromAcroType } from "@/lib/setupCalibrations/customFieldCatalog";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { PdfFormFieldsExtraction } from "@/lib/setupDocuments/pdfFormFields";
import { boxesFromCalibrationMappings } from "@/lib/setupSheetModels/boxesFromCalibration";
import {
  deriveSchemaFromAcroForm,
  labelFromAcroFieldName,
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
  /**
   * Schema key -> where it sits on this blank, for the DERIVED parameters only. The
   * calibration-only keys are deliberately absent: the calibration already maps them and is already
   * read for them, so copying the rule here would give one printed box two readers.
   */
  mappings: Record<string, PdfFormFieldMappingRule>;
  /** Which of `fields` are calibration-only keys rather than newly-derived boxes. */
  calibrationOnlyKeys: string[];
  /** Boxes the calibration already owns, so a run can report coverage honestly. */
  claimedWidgetCount: number;
  stats: DerivedSheetStats;
};

/**
 * The calibration names a key the schema never declared — mint the parameter it was missing.
 *
 * ================================ WHY THESE EXIST AT ALL ================================
 *
 * A calibration's left-hand side is a schema key, and nothing ever checked that the schema actually
 * had one. On the A800RR eight did not: `date`, `name`, `race`, `class`, `track`, `country`,
 * `air_temp`, `track_temp` — the printed header strip. `boxesFromCalibrationMappings` skips a mapped
 * key with no schema field (it has no label, no type and nothing to compare an option against), so
 * those eight had no box on screen and nothing to export, and a driver downloading their sheet got a
 * blank NAME / RACE / TRACK / DATE row. Measured 2026-08-14.
 *
 * The main union pass cannot reach them: their widgets ARE claimed — by the calibration — so it
 * correctly leaves them alone. The gap is on the schema side, and this closes it.
 *
 * The key is taken from the calibration verbatim, never minted, so it stays what any older import
 * already wrote into a saved setup. Only the label, type and visibility are new.
 *
 * Header boxes are document metadata, not tuning: they are kept off Log your run and out of
 * analysis, so a track name never turns up as a setup change or in a cross-car comparison.
 */
function fieldsForCalibrationOnlyKeys(input: {
  extraction: PdfFormFieldsExtraction;
  schema: Pick<SetupSheetModelSchema, "fields">;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  extraSimpleKeys?: Record<string, string>;
  sortBase: number;
}): SetupSheetModelFieldDef[] {
  const declared = new Set(input.schema.fields.map((f) => f.key));
  const byName = new Map(input.extraction.fields.map((f) => [f.name, f] as const));

  const missing: Array<{ key: string; rule?: PdfFormFieldMappingRule; pdfFieldName?: string }> = [];
  for (const [key, rule] of Object.entries(input.formFieldMappings)) {
    if (!declared.has(key)) missing.push({ key, rule });
  }
  for (const [key, pdfFieldName] of Object.entries(input.extraSimpleKeys ?? {})) {
    if (!declared.has(key) && !missing.some((m) => m.key === key)) missing.push({ key, pdfFieldName });
  }

  return missing.map(({ key, rule, pdfFieldName }, i) => {
    const r = (rule ?? {}) as {
      mode?: string;
      pdfFieldName?: string;
      options?: Record<string, unknown>;
    };
    const grouped =
      r.mode === "singleChoiceWidgetGroup"
      || r.mode === "multiSelectWidgetGroup"
      || r.mode === "singleChoiceNamedFields"
      || r.mode === "multiSelectNamedFields";
    const entry = byName.get(r.pdfFieldName ?? pdfFieldName ?? "");
    // No entry means the calibration names a box this PDF does not have: nothing to read a kind
    // from, so it falls to text exactly as an unrecognised field kind does.
    const uiType = grouped ? "select" : inferUiTypeFromAcroType(entry?.type ?? "Unknown");

    const base: SetupSheetModelFieldDef = {
      key,
      // `air_temp` → "Air temp". The key was written by whoever mapped the box, so it already says
      // what the box is; nothing better is available, since a calibration carries no labels.
      displayLabel: labelFromAcroFieldName(key) || key,
      sectionId: "grp_other",
      sectionTitle: "Other",
      valueType: uiType === "checkbox" ? "boolean" : "string",
      uiType,
      showInSetupSheet: true,
      showInLogRun: false,
      showInAnalysis: false,
      sortOrder: input.sortBase + i + 1,
    };
    if (!grouped) return base;

    // The rule's option keys ARE the stored values — that is what the calibrated read writes.
    const options = Object.keys(r.options ?? {});
    const multi = r.mode === "multiSelectWidgetGroup" || r.mode === "multiSelectNamedFields";
    return {
      ...base,
      valueType: multi ? "multi" : "enum",
      uiType: multi ? "multiSelect" : "select",
      groupBehaviorType: multi ? "multiChoiceGroup" : "singleSelect",
      groupedOptionLabels: options,
      groupedOptionValues: options,
    };
  });
}

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

  // Keys the calibration maps that the schema never declared. Minted first so they sort ahead of the
  // unnamed boxes — they are the header of the sheet, and they are the ones a person recognises.
  const calibrationOnly = fieldsForCalibrationOnlyKeys({
    extraction: input.extraction,
    schema: input.schema,
    formFieldMappings: input.formFieldMappings,
    extraSimpleKeys: input.extraSimpleKeys,
    sortBase,
  });

  /*
   * Their geometry comes from the ordinary calibration box builder, run against a schema that now
   * declares them — the same call the chassis was attached with, so a header box is placed by
   * exactly the rule that placed every other calibrated box (grouped options included). Only the new
   * keys are kept; every other box already exists in `boxesJson`.
   */
  const newKeys = new Set(calibrationOnly.map((f) => f.key));
  const calibrationOnlyBoxes = newKeys.size
    ? boxesFromCalibrationMappings({
        extraction: input.extraction,
        formFieldMappings: input.formFieldMappings,
        schema: { fields: [...input.schema.fields, ...calibrationOnly] },
        extraSimpleKeys: input.extraSimpleKeys,
      }).boxes.filter((b) => newKeys.has(b.key))
    : [];

  const derivedSortBase = sortBase + calibrationOnly.length;

  return {
    fields: [
      ...calibrationOnly,
      ...derived.schema.fields.map((f) => ({ ...f, sortOrder: derivedSortBase + (f.sortOrder ?? 0) })),
    ],
    boxes: [...calibrationOnlyBoxes, ...derived.boxes],
    mappings: derived.formFieldMappings,
    calibrationOnlyKeys: calibrationOnly.map((f) => f.key),
    claimedWidgetCount: claimed.length,
    stats: derived.stats,
  };
}
