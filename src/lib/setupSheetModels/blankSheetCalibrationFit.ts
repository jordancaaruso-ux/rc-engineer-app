/**
 * Does a blank AcroForm's drafted read rules actually belong to an existing sheet model?
 *
 * The wizard's repair path attaches a calibration to a model that already exists. Both sides key
 * off `keyFromAcroName`, so re-running the wizard with the SAME sheet produces near-identical keys
 * — but a different chassis' sheet produces almost none in common, and attaching it would recreate
 * the exact failure this work is fixing (a calibration that fingerprint-matches uploads and then
 * imports nothing). Pure function so the threshold is testable without a database.
 */

export type BlankSheetCalibrationFit = {
  /** Keys present in both the drafted mappings and the model schema. */
  matchedKeys: string[];
  /** Share of the MODEL's keys the mappings cover (0..1). */
  coverage: number;
  ok: boolean;
  reason: string;
};

/**
 * Coverage is measured against the model's own keys, not the PDF's: the wizard lets a driver untick
 * fields, so a legitimate re-run can map MORE keys than the model kept. Extra mapped keys are
 * therefore fine; missing ones are the signal that this is a different sheet.
 */
/**
 * Raised from 0.5 on founder's call, 2026-08-11 ("I feel like it should be over 50%").
 *
 * Half was always a weak bar for this question. The same sheet re-run covers ~100% of the model's
 * keys, because it is literally the same form layer — so anything that leaves a third of the
 * chassis unaccounted for is a different sheet, not a near miss. 0.8 still tolerates a revision
 * that moved a handful of boxes.
 */
export const MIN_MODEL_KEY_COVERAGE = 0.8;
/** Guards tiny/stub schemas, where a couple of generic keys ("notes") would clear any ratio. */
export const MIN_MATCHED_KEYS = 8;

export function assessBlankSheetCalibrationFit(
  mappingKeys: readonly string[],
  modelSchemaKeys: readonly string[]
): BlankSheetCalibrationFit {
  const mapped = new Set(mappingKeys);
  const modelKeys = [...new Set(modelSchemaKeys)];
  const matchedKeys = modelKeys.filter((k) => mapped.has(k));
  const coverage = modelKeys.length === 0 ? 0 : matchedKeys.length / modelKeys.length;

  if (modelKeys.length === 0) {
    return { matchedKeys, coverage, ok: false, reason: "The existing model has no fields to match against." };
  }
  if (matchedKeys.length < MIN_MATCHED_KEYS) {
    return {
      matchedKeys,
      coverage,
      ok: false,
      reason: `Only ${matchedKeys.length} of this model's ${modelKeys.length} fields appear on the uploaded PDF — too few to trust it as the same sheet.`,
    };
  }
  if (coverage < MIN_MODEL_KEY_COVERAGE) {
    return {
      matchedKeys,
      coverage,
      ok: false,
      reason: `The uploaded PDF covers only ${Math.round(coverage * 100)}% of this model's fields — it looks like a different sheet.`,
    };
  }
  return {
    matchedKeys,
    coverage,
    ok: true,
    reason: `Matched ${matchedKeys.length} of ${modelKeys.length} fields (${Math.round(coverage * 100)}%).`,
  };
}
