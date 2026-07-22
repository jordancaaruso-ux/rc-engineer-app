import "server-only";

import { prisma } from "@/lib/prisma";
import { isCalibrationGreenLit, normalizeCalibrationData } from "@/lib/setupCalibrations/types";

/**
 * Does uploading a setup sheet actually work for this car?
 *
 * The bar is a **green-lit** calibration, not merely a calibration that exists. An un-verified
 * calibration reads a sheet partially, and a partially-read setup is worse than none
 * (SETUP_UPLOAD_NORTH_STAR round 3: "the standard is 100%, carried by the calibration… until it
 * passes, the model isn't calibrated"). Having *a* calibration was the old gate, and it let the
 * Xray X4'26 offer an upload it couldn't honour (founder, 2026-07-22).
 *
 * Green-light is flipped per calibration in the chassis workbench (`/setup-sheet-models/[id]`),
 * which writes `verification.greenLitAt` into `calibrationDataJson`.
 *
 * Everything else — a chassis with no calibration, a user-created model, an unverified draft —
 * simply gets the create-a-setup flow instead.
 */

function anyGreenLit(
  rows: ReadonlyArray<{ calibrationDataJson: unknown }>
): boolean {
  return rows.some((r) => isCalibrationGreenLit(normalizeCalibrationData(r.calibrationDataJson)));
}

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
  return anyGreenLit(calibrations);
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
    if (isCalibrationGreenLit(normalizeCalibrationData(c.calibrationDataJson))) {
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
