import "server-only";

import { prisma } from "@/lib/prisma";
import { calibrationOpensUploadDoor } from "@/lib/setupCalibrations/uploadDoorRule";

/**
 * Can this car be handed a setup sheet to upload?
 *
 * The rule itself, and why it is no longer the green light, lives in `uploadDoorRule.ts` — kept
 * apart from the database so it can be tested on its own. Short version: being able to READ a
 * sheet and having the Engineer UNDERSTAND it are two different mechanisms, and this is the first.
 */

export async function carSupportsSheetUpload(
  car: { setupSheetModelId: string | null } | null | undefined
): Promise<boolean> {
  const modelId = car?.setupSheetModelId;
  if (!modelId) return false;

  // Setup sheet models are global — never scope this read by userId.
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: { setupSheetModelId: modelId },
    select: { calibrationDataJson: true },
  });
  return calibrations.some((c) => calibrationOpensUploadDoor(c.calibrationDataJson));
}

/**
 * Batched form for lists of cars — one query regardless of car count, so the garage hub and other
 * multi-car surfaces don't fan out per row.
 */
export async function setupSheetModelIdsSupportingUpload(
  modelIds: ReadonlyArray<string | null>
): Promise<Set<string>> {
  const ids = [...new Set(modelIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Set();

  // Setup sheet models are global — never scope this read by userId.
  const calibrations = await prisma.setupSheetCalibration.findMany({
    where: { setupSheetModelId: { in: ids } },
    select: { setupSheetModelId: true, calibrationDataJson: true },
  });

  const supported = new Set<string>();
  for (const c of calibrations) {
    if (!c.setupSheetModelId) continue;
    if (supported.has(c.setupSheetModelId)) continue;
    if (calibrationOpensUploadDoor(c.calibrationDataJson)) {
      supported.add(c.setupSheetModelId);
    }
  }
  return supported;
}

/** Same question, for a car id the caller has already authorized. */
export async function carIdSupportsSheetUpload(
  userId: string,
  carId: string | null | undefined
): Promise<boolean> {
  if (!carId) return false;
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetModelId: true },
  });
  return carSupportsSheetUpload(car);
}
