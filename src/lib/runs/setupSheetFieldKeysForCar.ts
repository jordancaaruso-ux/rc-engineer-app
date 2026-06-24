import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { prisma } from "@/lib/prisma";
import { collectSetupSheetTemplateKeys } from "@/lib/setupSheetModels/collectTemplateKeys";
import { resolveSetupSheetModelForCar } from "@/lib/setupSheetModels/resolveModelForCar";
import { getDefaultSetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import {
  buildSetupSheetTemplateFromParsedSchema,
} from "@/lib/setupSheetModels/buildSetupSheetTemplate";

/** Field keys available on the car's active setup sheet (model schema or legacy template). */
export async function getSetupSheetFieldKeysForCar(
  userId: string,
  carId: string
): Promise<Set<string>> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) return new Set();

  const model = await resolveSetupSheetModelForCar(userId, car);
  if (model) {
    return new Set(model.schema.fields.map((f) => f.key));
  }

  const template = isA800RRCar(car.setupSheetTemplate)
    ? A800RR_SETUP_SHEET_V1
    : getDefaultSetupSheetTemplate();
  return collectSetupSheetTemplateKeys(template);
}

/** Same as getSetupSheetFieldKeysForCar but accepts an already-resolved car row. */
export async function getSetupSheetFieldKeysForCarRow(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null }
): Promise<Set<string>> {
  const model = await resolveSetupSheetModelForCar(userId, car);
  if (model) {
    return new Set(model.schema.fields.map((f) => f.key));
  }
  const template = isA800RRCar(car.setupSheetTemplate)
    ? A800RR_SETUP_SHEET_V1
    : getDefaultSetupSheetTemplate();
  return collectSetupSheetTemplateKeys(template);
}

/** Build a logRun template for UI gating without an extra HTTP round trip. */
export function setupSheetTemplateFromModelSchema(
  modelId: string,
  modelName: string,
  schema: Parameters<typeof buildSetupSheetTemplateFromParsedSchema>[2]
) {
  return buildSetupSheetTemplateFromParsedSchema(modelId, modelName, schema, "logRun");
}
