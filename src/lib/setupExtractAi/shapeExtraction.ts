import { isFlagged, type ExtractionSchema, type SetupSheetAiExtraction } from "@/lib/setupExtractAi/types";

/**
 * Pure shaping of a raw extraction into app-native values + a review report.
 * No server-only deps, so the eval/demo scripts and the server orchestration share it.
 *
 * Trust policy (grounded in the Xray X4'22 eval, scripts/setup-extract-eval): 100% of the
 * reader's *confident* mistakes are checkbox/choice fields — it never confidently misreads a
 * written number or text value. So high-confidence text/number values auto-import, and every
 * choice/checkbox field is routed to review regardless of confidence. On the gold set this
 * leaves zero silently-shipped confident errors. Stage 2 (region mark-detection) is what lets
 * choice fields become trustworthy enough to auto-import and removes this review load.
 */

export type AiExtractionShaped = {
  /** App-native setup values (non-empty only), keyed by the model's field keys. */
  parsedData: Record<string, string>;
  /** Per-field confidence for every schema field the reader returned. */
  confidence: Record<string, number>;
  /** Fields the reviewer must confirm: low confidence, a pass disagreement, or a choice field. */
  flaggedKeys: string[];
  /** Fields where the two passes disagreed (subset of flaggedKeys). */
  disagreedKeys: string[];
  modelName: string;
  schemaLabel: string;
  fieldCount: number;
  importedCount: number;
};

export function shapeExtraction(
  extraction: SetupSheetAiExtraction,
  schema?: ExtractionSchema
): AiExtractionShaped {
  const choiceKeys = new Set((schema?.fields ?? []).filter((f) => f.valueType === "choice").map((f) => f.key));
  const parsedData: Record<string, string> = {};
  const confidence: Record<string, number> = {};
  const flaggedKeys: string[] = [];
  const disagreedKeys: string[] = [];

  for (const f of extraction.fields) {
    confidence[f.key] = f.confidence;
    if (f.value !== "") parsedData[f.key] = f.value;
    if (f.disagreementValue !== undefined) disagreedKeys.push(f.key);
    // Flag low-confidence fields (a blank one still warrants a look — the reader may have
    // missed a value) AND every choice field (the confident-error class lives entirely there).
    if (isFlagged(f) || choiceKeys.has(f.key)) flaggedKeys.push(f.key);
  }

  return {
    parsedData,
    confidence,
    flaggedKeys,
    disagreedKeys,
    modelName: extraction.model,
    schemaLabel: extraction.schemaLabel,
    fieldCount: extraction.fields.length,
    importedCount: Object.keys(parsedData).length,
  };
}
