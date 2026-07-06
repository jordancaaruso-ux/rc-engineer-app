import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import { buildExtractionSchemaFromModel } from "@/lib/setupExtractAi/schemaFromSetupModel";
import { extractSetupFromImage } from "@/lib/setupExtractAi/extractSetupFromImage";
import { isFlagged, type ExtractionSchema, type SetupSheetAiExtraction } from "@/lib/setupExtractAi/types";

export type AiExtractionForImageResult = {
  ran: boolean;
  /** Why extraction was skipped (only set when ran === false). */
  skippedReason?: "no_api_key" | "no_model_schema" | "unsupported_mime";
  /** App-native setup values (non-empty only), keyed by the model's field keys. */
  parsedData: Record<string, string>;
  /** Per-field confidence for every schema field the reader returned. */
  confidence: Record<string, number>;
  /** Fields the reviewer must confirm: low confidence or the two passes disagreed. */
  flaggedKeys: string[];
  /** Fields where the two passes disagreed (subset of flaggedKeys). */
  disagreedKeys: string[];
  modelName: string;
  schemaLabel: string;
  fieldCount: number;
  importedCount: number;
};

const IMAGE_MIME: Record<string, "image/png" | "image/jpeg"> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
};

/**
 * Stage-1 AI vision extraction for an uploaded IMAGE setup document that has no matching
 * calibration (SETUP_UPLOAD_NORTH_STAR.md). Resolves the car's setup-sheet model, targets
 * the reader at those field keys, and returns app-native values + a per-field confidence
 * report the confidence-gated review surface can consume.
 *
 * Never throws for "can't run" cases — returns ran:false so the caller falls back to its
 * existing behavior. Genuine extraction failures (network/parse) do throw, for the caller
 * to catch and log like any other stage.
 */
export async function runAiExtractionForImageDoc(input: {
  file: File;
  mimeType: string | null;
  userId: string;
  setupSheetModelId: string | null;
  setupSheetTemplate: string | null;
  /** Override models (else the eval-picked cross-model defaults). */
  model?: string;
  modelB?: string;
}): Promise<AiExtractionForImageResult> {
  const empty = (skippedReason: AiExtractionForImageResult["skippedReason"]): AiExtractionForImageResult => ({
    ran: false,
    skippedReason,
    parsedData: {},
    confidence: {},
    flaggedKeys: [],
    disagreedKeys: [],
    modelName: "",
    schemaLabel: "",
    fieldCount: 0,
    importedCount: 0,
  });

  const apiKey = getOpenAiApiKey();
  if (!apiKey) return empty("no_api_key");

  const mime = IMAGE_MIME[(input.mimeType ?? input.file.type ?? "").toLowerCase()];
  if (!mime) return empty("unsupported_mime");

  const resolved = await resolveSetupSheetModelForCar(input.userId, {
    setupSheetModelId: input.setupSheetModelId,
    setupSheetTemplate: input.setupSheetTemplate,
  });
  if (!resolved) return empty("no_model_schema");

  const schema = buildExtractionSchemaFromModel({ model: resolved.schema });
  if (schema.fields.length === 0) return empty("no_model_schema");

  const imageBytes = Buffer.from(await input.file.arrayBuffer());
  const extraction = await extractSetupFromImage({
    apiKey,
    imageBytes,
    imageMime: mime,
    schema,
    model: input.model,
    modelB: input.modelB,
  });

  return shapeExtraction(extraction, schema);
}

/**
 * Pure shaping of a raw extraction into app-native values + a review report.
 *
 * Trust policy (grounded in the Xray X4'22 eval, scripts/setup-extract-eval): 100% of the
 * reader's *confident* mistakes are checkbox/choice fields — it never confidently misreads a
 * written number or text value. So high-confidence text/number values auto-import, and every
 * choice/checkbox field is routed to review regardless of confidence. On the gold set this
 * leaves zero silently-shipped confident errors. Stage 2 (region mark-detection) is what lets
 * choice fields become trustworthy enough to auto-import and removes this review load.
 */
export function shapeExtraction(
  extraction: SetupSheetAiExtraction,
  schema?: ExtractionSchema
): AiExtractionForImageResult {
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
    ran: true,
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
