/**
 * Stage 2A pilot — apply a blank-sheet draft (schema + ImageCalibration) to the live
 * SetupSheetModel. SAFE BY DEFAULT: dry-run prints the plan and changes nothing.
 *
 *   Dry-run: npm run setup-extract:blank-apply
 *   Apply:   npm run setup-extract:blank-apply -- --apply
 *   Flags:   --model-id=<id> (skip name search) --match=<substr> (default "x4'26")
 *            --owner-email=<email> (calibration owner; default the only admin user)
 *
 * Replaces the model's schemaJson (the mangled filled-sheet draft) with the blank-derived
 * schema, upserts a "blank sheet (auto)" calibration carrying the ImageCalibration, and
 * links it as the model's default calibration. Existing docs keep their old parsed keys —
 * re-run processing on them after applying.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/prisma";
import { draftedSchemaToModelSchema } from "@/lib/setupExtractAi/draftedSchemaToModelSchema";
import { parseSetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import type { DraftedSchema } from "@/lib/setupExtractAi/draftSetupSheetModelSchema";
import type { ImageCalibration } from "@/lib/setupCalibrations/types";
import { normalizeImageCalibration } from "@/lib/setupCalibrations/types";

const APPLY = process.argv.includes("--apply");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const styleDir = arg("style") ?? "xray-x4-2026";
  const draftPath = join(process.cwd(), "scripts", "setup-extract-eval", "gold", styleDir, "blank-calibration.json");
  const draft = JSON.parse(readFileSync(draftPath, "utf8")) as {
    draftedSchema: DraftedSchema;
    imageCalibration: ImageCalibration;
  };
  const imageCalibration = normalizeImageCalibration(draft.imageCalibration);
  if (!imageCalibration) throw new Error("Draft imageCalibration failed normalization");
  const modelSchema = draftedSchemaToModelSchema({
    carName: draft.draftedSchema.carName,
    fields: draft.draftedSchema.fields,
  });
  const roundTrip = parseSetupSheetModelSchema(modelSchema);
  if (!roundTrip || roundTrip.fields.length !== modelSchema.fields.length) {
    throw new Error(
      `Schema round-trip failed: ${roundTrip?.fields.length ?? 0}/${modelSchema.fields.length} fields survived`
    );
  }

  const modelId = arg("model-id");
  const match = (arg("match") ?? "x4'26").toLowerCase();
  const candidates = modelId
    ? await prisma.setupSheetModel.findMany({ where: { id: modelId } })
    : (await prisma.setupSheetModel.findMany()).filter((m) => m.name.toLowerCase().includes(match));
  if (candidates.length !== 1) {
    console.error(
      `Need exactly one model (got ${candidates.length}):\n`
        + candidates.map((m) => `  ${m.id}  ${m.name}  (slug=${m.slug})`).join("\n")
        + `\nUse --model-id=<id>.`
    );
    process.exit(1);
  }
  const model = candidates[0]!;
  const oldSchema = parseSetupSheetModelSchema(model.schemaJson);

  const ownerEmail = arg("owner-email");
  const owner = ownerEmail
    ? await prisma.user.findFirst({ where: { email: ownerEmail } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("No owner user found for the calibration row");

  const calName = `${draft.draftedSchema.carName} — blank sheet (auto)`;
  const existingCal = await prisma.setupSheetCalibration.findFirst({
    where: { setupSheetModelId: model.id, name: calName },
  });
  const calibrationDataJson = {
    templateType: "image_region_v1",
    fields: {},
    imageCalibration,
  };

  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} blank-sheet draft → model ${model.id} (${model.name})`);
  console.log(`  schema: ${oldSchema?.fields.length ?? "?"} fields → ${modelSchema.fields.length} fields`);
  console.log(
    `  calibration: ${existingCal ? `update ${existingCal.id}` : "create"} "${calName}" `
      + `(${imageCalibration.fields.length} regions, owner ${owner.email})`
  );
  console.log(`  model.defaultCalibrationId: ${model.defaultCalibrationId ?? "null"} → (this calibration)`);
  if (!APPLY) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }

  const cal = existingCal
    ? await prisma.setupSheetCalibration.update({
        where: { id: existingCal.id },
        data: { calibrationDataJson: calibrationDataJson as object },
      })
    : await prisma.setupSheetCalibration.create({
        data: {
          name: calName,
          sourceType: "blank_sheet_image_v1",
          calibrationDataJson: calibrationDataJson as object,
          setupSheetModelId: model.id,
          userId: owner.id,
        },
      });
  await prisma.setupSheetModel.update({
    where: { id: model.id },
    data: { schemaJson: modelSchema as object, defaultCalibrationId: cal.id },
  });
  console.log(`Applied. calibration=${cal.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
