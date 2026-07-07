"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";

/**
 * Admin whole-sheet green-light on a model's calibration (SETUP_UPLOAD_NORTH_STAR round 4):
 * verified calibrations import silently. Ops: green_light | revoke | clear_recheck.
 */
export async function setCalibrationVerificationAction(formData: FormData): Promise<void> {
  const calibrationId = String(formData.get("calibrationId") ?? "").trim();
  const modelId = String(formData.get("modelId") ?? "").trim();
  const op = String(formData.get("op") ?? "").trim();
  if (!calibrationId || !["green_light", "revoke", "clear_recheck"].includes(op)) {
    throw new Error("Invalid verification request");
  }

  const user = await requireCurrentUser();
  if (!isAuthAdminEmail(user.email)) {
    throw new Error("Only an admin can change calibration verification.");
  }

  const calibration = await prisma.setupSheetCalibration.findUnique({
    where: { id: calibrationId },
    select: { id: true, calibrationDataJson: true },
  });
  if (!calibration) throw new Error("Calibration not found");

  const data = normalizeCalibrationData(calibration.calibrationDataJson);
  if (op === "green_light") {
    data.verification = {
      greenLitAt: new Date().toISOString(),
      greenLitByUserId: user.id,
    };
  } else if (op === "revoke") {
    data.verification = undefined;
  } else if (op === "clear_recheck") {
    if (data.verification) data.verification.fieldsNeedingRecheck = undefined;
  }

  await prisma.setupSheetCalibration.update({
    where: { id: calibrationId },
    data: { calibrationDataJson: data as unknown as object },
  });

  if (modelId) revalidatePath(`/setup-sheet-models/${modelId}`);
}
