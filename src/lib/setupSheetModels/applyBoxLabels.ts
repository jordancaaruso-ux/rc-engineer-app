import type { SetupSheetModelSchema, SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import { isPlaceholderLabel } from "@/lib/setupSheetModels/sheetPlan";

/**
 * Give boxes their real names.
 *
 * ============================== WHAT MAY CHANGE, AND WHAT MAY NOT ==============================
 *
 * The KEY never changes. A key is frozen into every setup, draft, baseline and comparison the
 * moment anyone saves against this chassis, so renaming one silently empties saved sheets. The
 * label is free — it is what people read, and nothing is stored against it.
 *
 * ============================== WHY NAMING DOES MORE THAN RENAME ==============================
 *
 * A box read off a PDF is keyed `text47`, and `text47` pools nowhere. So calling it "Camber
 * (Front)" and stopping there would change what the founder sees and nothing else: the community
 * numbers are keyed by universal parameter, and this box would still contribute to none of them.
 *
 * So a name that the app recognises also declares the parameter it means, which is what
 * `resolveUniversalParameterId` reads to put this box in with every other car's front camber. A
 * name it does not recognise is still a perfectly good name — it just pools nowhere, which is the
 * truth about a knob only this car has.
 *
 * A named box also stops being held out of the log-run form and comparisons, which is what it was
 * being held out of FOR: an unnamed box means nothing to a driver reading a diff.
 *
 * Boxes split out of one PDF field stay out of analysis even when named — "row of ticks, box 2 of
 * 5 = on" is not an answer to anything until someone merges the row into one choice.
 */

/** Split boxes carry this suffix; see `deriveSchemaFromAcroForm`. */
const SPLIT_BOX_KEY = /__b\d+$/;

export type ApplyBoxLabelsResult = {
  schema: SetupSheetModelSchema;
  /** Keys whose label actually moved. */
  changed: string[];
  /** Keys that now declare a universal parameter, with the id they declare. */
  pooled: Array<{ key: string; universalParameterId: string }>;
  /** Keys asked for that this sheet does not have. Reported, never invented. */
  unknownKeys: string[];
};

export function applyBoxLabels(
  schema: SetupSheetModelSchema,
  labels: Record<string, string>
): ApplyBoxLabelsResult {
  const byKey = new Map(schema.fields.map((f) => [f.key, f] as const));
  const changed: string[] = [];
  const pooled: Array<{ key: string; universalParameterId: string }> = [];
  const unknownKeys: string[] = [];
  const nextByKey = new Map<string, SetupSheetModelFieldDef>();

  for (const [key, raw] of Object.entries(labels)) {
    const field = byKey.get(key);
    if (!field) {
      unknownKeys.push(key);
      continue;
    }
    const label = typeof raw === "string" ? raw.trim() : "";
    // An empty box means "I did not name this one", never "wipe the label". There is nothing to
    // put back if it were wiped: the position label was generated during derivation and the app
    // cannot regenerate it from the schema alone.
    if (!label || label === field.displayLabel) continue;

    const universalParameterId = suggestUniversalParameterId(field.key, label);
    const named: SetupSheetModelFieldDef = {
      ...field,
      displayLabel: label,
      showInLogRun: true,
      showInAnalysis: !SPLIT_BOX_KEY.test(field.key),
      ...(universalParameterId ? { universalParameterId } : {}),
    };
    nextByKey.set(key, named);
    changed.push(key);
    if (universalParameterId) pooled.push({ key, universalParameterId });
  }

  return {
    schema: { ...schema, fields: schema.fields.map((f) => nextByKey.get(f.key) ?? f) },
    changed,
    pooled,
    unknownKeys,
  };
}

/** How much of a sheet has been said out loud. */
export function namedBoxCount(schema: Pick<SetupSheetModelSchema, "fields">): number {
  return schema.fields.filter((f) => !isPlaceholderLabel(f.displayLabel)).length;
}
