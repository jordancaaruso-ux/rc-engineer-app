import "server-only";

import { prisma } from "@/lib/prisma";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import { buildExtractionSchemaFromModel } from "@/lib/setupExtractAi/schemaFromSetupModel";
import { extractSetupFromImage } from "@/lib/setupExtractAi/extractSetupFromImage";
import { shapeExtraction, type AiExtractionShaped } from "@/lib/setupExtractAi/shapeExtraction";
import { normalizeCalibrationData, type ImageCalibration } from "@/lib/setupCalibrations/types";
import {
  extractImageRawDataFromFile,
  mapExtractedImageWithCalibration,
} from "@/lib/setupCalibrations/imageExtractPipeline";

export type AiExtractionForImageResult = AiExtractionShaped & {
  ran: boolean;
  /** Why extraction was skipped (only set when ran === false). */
  skippedReason?: "no_api_key" | "no_model_schema" | "unsupported_mime";
  /** Choice-field keys whose value came from the blank-sheet region read (Stage 2A). */
  regionKeys?: string[];
  /** True when the model's default calibration carries the admin green-light. */
  calibrationGreenLit?: boolean;
  /**
   * Reader flags suppressed by the green-light (round-4 silent-import policy): the values
   * imported anyway; the keys are kept as an admin calibration-quality signal, not for review.
   */
  suppressedFlaggedKeys?: string[];
};

/**
 * Stage 2A region adjudication (SETUP_UPLOAD_NORTH_STAR.md): when the doc's sheet model has a
 * blank-sheet calibration, run darkness mark-detection on its CHOICE regions and let the result
 * adjudicate the full-page reader — the eval showed 100% of confident reader mistakes are
 * choice fields, and region detection on a known box is exactly what fixes them. Text regions
 * are skipped (the reader is already reliable there and crop-OCR would cost an extra call).
 * Choice fields remain review-routed regardless (founder call: calibrations never get blind
 * trust) — this improves the values and confidence the reviewer sees, not the routing.
 */
async function runRegionChoiceRead(input: {
  file: File;
  imageCalibration: ImageCalibration;
}): Promise<Record<string, string> | null> {
  const choiceFields = input.imageCalibration.fields.filter((f) => f.kind !== "text");
  if (choiceFields.length === 0) return null;
  const calibrationDataJson = {
    templateType: "image_region_v1",
    fields: {},
    imageCalibration: { reference: input.imageCalibration.reference, fields: choiceFields },
  };
  const raw = await extractImageRawDataFromFile({
    file: input.file,
    calibrationDataJsonForMeta: calibrationDataJson,
  });
  // A grossly misaligned upload (different template revision, heavy crop) must not adjudicate.
  if (raw.anchorMatchScore < 0.4) return null;
  const mapped = await mapExtractedImageWithCalibration({
    extracted: raw,
    calibrationDataJson,
  });
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapped.parsedData)) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

/**
 * Merge the reader's text-field result with the region read's choice-field result.
 *
 * Trust policy (SETUP_UPLOAD_NORTH_STAR.md Stage 2A, founder interview 2026-07-07): choice
 * fields come from region mark-detection on a calibrated box, which the pilot showed accurate,
 * so a confident detection AUTO-IMPORTS silently — no review. Only choices where region
 * detection found no confident mark (blank box or ambiguous darkness) surface as a "miss" for
 * the reviewer. This replaces the pre-region policy that flagged every choice field (written
 * when choices came from the full-page reader, which did confidently misread them). Text fields
 * keep the reader's own gating (low-confidence or dual-model disagreement → flagged); everything
 * else imports silently, including noise fields the admin never curated out ("keep all").
 */
function mergeReaderAndRegions(
  shaped: AiExtractionShaped,
  regionValues: Record<string, string>,
  choiceKeys: Set<string>,
  totalFieldCount: number
): AiExtractionShaped & { regionKeys: string[] } {
  const parsedData = { ...shaped.parsedData };
  const confidence = { ...shaped.confidence };
  const flagged = new Set(shaped.flaggedKeys);
  const regionKeys: string[] = [];
  for (const key of choiceKeys) {
    const value = regionValues[key] ?? "";
    if (value) {
      // Confident mark on a calibrated box → trusted, auto-import, do NOT flag.
      parsedData[key] = value;
      confidence[key] = 0.9;
      regionKeys.push(key);
    } else {
      // No confident mark: treat as a blank box — import nothing and DO NOT flag. On the
      // sheet most such fields are genuinely unset options, not detection failures, and the
      // founder's "auto-import silently, review only misses/conflicts" call (2026-07-07) means
      // an empty checkbox is not something to review. A rare faint/near-miss mark is the
      // accepted risk of auto-import; the admin calibration is the reliability mechanism.
      confidence[key] = 0;
    }
  }
  return {
    ...shaped,
    parsedData,
    confidence,
    flaggedKeys: [...flagged],
    fieldCount: totalFieldCount,
    importedCount: Object.keys(parsedData).length,
    regionKeys,
  };
}

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

  // Stage 2A: when the model has a blank-sheet calibration, choice fields are read by region
  // darkness (measured better than the full-page reader on exactly that class) and the reader
  // covers text fields only — fewer fields keeps the dual-model pass inside the stage timeout.
  let imageCalibration: ImageCalibration | undefined;
  let calibrationGreenLit = false;
  try {
    const modelRow = input.setupSheetModelId
      ? await prisma.setupSheetModel.findUnique({
          where: { id: input.setupSheetModelId },
          select: { defaultCalibration: { select: { calibrationDataJson: true } } },
        })
      : null;
    const calData = modelRow?.defaultCalibration
      ? normalizeCalibrationData(modelRow.defaultCalibration.calibrationDataJson)
      : undefined;
    imageCalibration = calData?.imageCalibration;
    calibrationGreenLit = Boolean(calData?.verification?.greenLitAt);
  } catch (e) {
    console.warn(`[setup-ai-extract] calibration lookup failed (${e instanceof Error ? e.message : String(e)})`);
  }

  if (imageCalibration) {
    const calibrationKeys = new Set(imageCalibration.fields.map((f) => f.key));
    const choiceKeys = new Set(
      schema.fields.filter((f) => f.valueType === "choice" && calibrationKeys.has(f.key)).map((f) => f.key)
    );
    const readerSchema = { ...schema, fields: schema.fields.filter((f) => !choiceKeys.has(f.key)) };
    const [extraction, regionValues] = await Promise.all([
      extractSetupFromImage({
        apiKey,
        imageBytes,
        imageMime: mime,
        schema: readerSchema,
        model: input.model,
        modelB: input.modelB,
      }),
      runRegionChoiceRead({ file: input.file, imageCalibration }).catch((e: unknown) => {
        console.warn(`[setup-ai-extract] region read failed (${e instanceof Error ? e.message : String(e)})`);
        return null;
      }),
    ]);
    const shaped = shapeExtraction(extraction, readerSchema);
    const merged = mergeReaderAndRegions(shaped, regionValues ?? {}, choiceKeys, schema.fields.length);
    // Round-4 silent-import policy (SETUP_UPLOAD_NORTH_STAR): a green-lit calibration carries
    // the trust — remaining reader flags (low-confidence / dual-model disagreement on text)
    // import anyway and are kept only as an admin calibration-quality signal.
    if (calibrationGreenLit && merged.flaggedKeys.length > 0) {
      return {
        ran: true,
        ...merged,
        flaggedKeys: [],
        suppressedFlaggedKeys: merged.flaggedKeys,
        calibrationGreenLit,
      };
    }
    return { ran: true, ...merged, calibrationGreenLit };
  }

  const extraction = await extractSetupFromImage({
    apiKey,
    imageBytes,
    imageMime: mime,
    schema,
    model: input.model,
    modelB: input.modelB,
  });
  return { ran: true, ...shapeExtraction(extraction, schema) };
}
