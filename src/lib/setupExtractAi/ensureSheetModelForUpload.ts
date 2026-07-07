import "server-only";

import { prisma } from "@/lib/prisma";
import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import { identifySheetCar } from "@/lib/setupExtractAi/identifySheetCar";
import { matchSheetModelForIdentifiedCar } from "@/lib/setupExtractAi/matchSheetModel";
import { draftSetupSheetModelSchema } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import { draftedSchemaToModelSchema } from "@/lib/setupExtractAi/draftedSchemaToModelSchema";
import { slugifySetupSheetModelName, uniqueSlugCandidate } from "@/lib/setupSheetModels/slug";

export type EnsureSheetModelResult =
  | { outcome: "skipped"; reason: "no_api_key" | "unsupported_mime" | "low_confidence_id" }
  | {
      outcome: "matched";
      modelId: string;
      modelName: string;
      identifiedName: string;
    }
  | {
      outcome: "created";
      modelId: string;
      modelName: string;
      identifiedName: string;
      carId: string;
      fieldCount: number;
      universalMappedCount: number;
    };

const MIN_ID_CONFIDENCE = 0.7;

/**
 * The "any car" front door for an unrecognized image upload (SETUP_UPLOAD_NORTH_STAR.md
 * Stage 1.4/1.5): read the printed brand/model from the sheet, match it against the global
 * sheet-model catalog, and when it's genuinely new, create the SetupSheetModel (AI-drafted
 * schema, `isAuthorized: false` per governance — private-quality until admin review) plus a
 * car for the uploader so the setup has somewhere to live.
 *
 * Never throws for "can't help" cases — returns skipped so quick-create falls back to the
 * existing calibrate-manually path.
 */
export async function ensureSheetModelForUpload(input: {
  userId: string;
  imageBytes: Buffer;
  mimeType: string;
}): Promise<EnsureSheetModelResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { outcome: "skipped", reason: "no_api_key" };
  const mime = input.mimeType === "image/png" ? "image/png" : input.mimeType === "image/jpeg" || input.mimeType === "image/jpg" ? "image/jpeg" : null;
  if (!mime) return { outcome: "skipped", reason: "unsupported_mime" };

  const identified = await identifySheetCar({ apiKey, imageBytes: input.imageBytes, imageMime: mime });
  const identifiedName = [identified.brand, identified.model].filter(Boolean).join(" ").trim();
  if (!identifiedName || identified.confidence < MIN_ID_CONFIDENCE) {
    return { outcome: "skipped", reason: "low_confidence_id" };
  }

  // Models are global (shared catalog with creator attribution) — match against all of them.
  const candidates = await prisma.setupSheetModel.findMany({
    select: { id: true, name: true },
    take: 500,
  });
  const match = matchSheetModelForIdentifiedCar(identified, candidates);
  if (match.isConfidentMatch && match.bestMatchId) {
    const name = candidates.find((c) => c.id === match.bestMatchId)?.name ?? identifiedName;
    return { outcome: "matched", modelId: match.bestMatchId, modelName: name, identifiedName };
  }

  // Genuinely new car: draft its schema from the sheet and create model + car.
  const draft = await draftSetupSheetModelSchema({
    apiKey,
    imageBytes: input.imageBytes,
    imageMime: mime,
    carName: identifiedName,
  });
  if (draft.fields.length < 10) {
    // A sheet we can identify but not meaningfully catalogue — don't create a junk model.
    return { outcome: "skipped", reason: "low_confidence_id" };
  }
  const schemaJson = draftedSchemaToModelSchema({ carName: identifiedName, fields: draft.fields });

  const existingSlugs = new Set(
    (await prisma.setupSheetModel.findMany({ select: { slug: true } })).map((m) => m.slug)
  );
  const slug = uniqueSlugCandidate(slugifySetupSheetModelName(identifiedName), existingSlugs);

  const model = await prisma.setupSheetModel.create({
    data: {
      name: identifiedName,
      slug,
      schemaJson: schemaJson as object,
      isAuthorized: false, // admin reviews/promotes per governance
      userId: input.userId,
    },
    select: { id: true, name: true },
  });
  const car = await prisma.car.create({
    data: {
      name: identifiedName,
      userId: input.userId,
      setupSheetModelId: model.id,
    },
    select: { id: true },
  });
  console.log(
    `[ensureSheetModelForUpload] created model=${model.id} slug=${slug} car=${car.id} fields=${draft.fields.length} universal=${draft.universalMappedCount} for user=${input.userId}`
  );

  return {
    outcome: "created",
    modelId: model.id,
    modelName: model.name,
    identifiedName,
    carId: car.id,
    fieldCount: draft.fields.length,
    universalMappedCount: draft.universalMappedCount,
  };
}
