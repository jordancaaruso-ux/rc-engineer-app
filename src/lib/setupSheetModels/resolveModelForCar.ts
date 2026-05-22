import { prisma } from "@/lib/prisma";
import { SETUP_SHEET_TEMPLATE_A800RR, isA800RRCar } from "@/lib/setupSheetTemplateId";
import { parseSetupSheetModelSchema, type SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetModels/seedA800Model";

export type ResolvedSetupSheetModel = {
  id: string;
  name: string;
  slug: string;
  schema: SetupSheetModelSchema;
};

export async function loadSetupSheetModelById(
  userId: string,
  modelId: string
): Promise<ResolvedSetupSheetModel | null> {
  const row = await prisma.setupSheetModel.findFirst({
    where: { id: modelId, userId },
    select: { id: true, name: true, slug: true, schemaJson: true },
  });
  if (!row) return null;
  const schema = parseSetupSheetModelSchema(row.schemaJson);
  if (!schema) return null;
  return { id: row.id, name: row.name, slug: row.slug, schema };
}

export async function resolveSetupSheetModelForCar(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null }
): Promise<ResolvedSetupSheetModel | null> {
  if (car.setupSheetModelId) {
    return loadSetupSheetModelById(userId, car.setupSheetModelId);
  }
  if (isA800RRCar(car.setupSheetTemplate)) {
    const seeded = await prisma.setupSheetModel.findFirst({
      where: { userId, slug: SETUP_SHEET_MODEL_SLUG_A800RR },
      select: { id: true, name: true, slug: true, schemaJson: true },
    });
    if (seeded) {
      const schema = parseSetupSheetModelSchema(seeded.schemaJson);
      if (schema) return { id: seeded.id, name: seeded.name, slug: seeded.slug, schema };
    }
  }
  return null;
}

export async function canonicalSetupSheetModelIdForUserCarId(
  userId: string,
  carId: string
): Promise<string | null> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetModelId: true, setupSheetTemplate: true },
  });
  if (!car) return null;
  const resolved = await resolveSetupSheetModelForCar(userId, car);
  return resolved?.id ?? null;
}

/** Legacy template string for documents that still use setupSheetTemplate. */
export function legacyTemplateFromModelSlug(slug: string): string | null {
  if (slug === SETUP_SHEET_MODEL_SLUG_A800RR) return SETUP_SHEET_TEMPLATE_A800RR;
  return null;
}
