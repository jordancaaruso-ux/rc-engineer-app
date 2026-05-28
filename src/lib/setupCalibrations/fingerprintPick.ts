import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildCalibrationFingerprints,
  repickCalibrationForBytes,
  type RepickOutcome,
} from "@/lib/setupCalibrations/autoPickCalibration";

export type FingerprintPickContext = {
  userId: string;
  bytes: Uint8Array;
  debugPrefix?: string;
  /** Car’s setup sheet model (e.g. Mugen MTC3) — used for mismatch warnings and auto-link, not to filter candidates. */
  carSetupSheetModelId?: string | null;
  carSetupSheetModelName?: string | null;
};

export type FingerprintPickResult = RepickOutcome & {
  /** Plain-language note for review UI / needsReviewReason. */
  userNote: string | null;
  modelMismatch: boolean;
};

function humanPickNote(outcome: RepickOutcome): string | null {
  if (outcome.pickSource === "exact_fingerprint" && outcome.pickedCalibrationName) {
    return `Matched calibration “${outcome.pickedCalibrationName}” from the PDF form layout.`;
  }
  if (outcome.pickSource === "ambiguous_suggestion" && outcome.pickedCalibrationName) {
    return `Several calibrations share this PDF layout; using “${outcome.pickedCalibrationName}”.`;
  }
  if (outcome.pickSource === "none") {
    if (outcome.pickDebug.includes("no_candidates")) {
      return "No calibration has a linked example PDF with the same form fields as this file.";
    }
    if (outcome.pickDebug.includes("no_exact_match")) {
      return "No calibration’s example PDF matches this form layout exactly — pick one manually or map a new calibration.";
    }
    if (outcome.pickDebug.includes("ambiguous")) {
      return "Multiple calibrations match this PDF layout — pick the correct one below.";
    }
  }
  return null;
}

/**
 * Pick calibration by AcroForm fingerprint across all user/community calibrations with example PDFs.
 */
export async function pickCalibrationByFingerprint(
  input: FingerprintPickContext
): Promise<FingerprintPickResult> {
  const prefix = input.debugPrefix ?? "auto";
  const candidates = await buildCalibrationFingerprints({ userId: input.userId });
  const outcome = await repickCalibrationForBytes(input.bytes, candidates, {
    debugPrefix: prefix,
    suggestOnAmbiguous: true,
  });
  let modelMismatch = false;
  let userNote = humanPickNote(outcome);

  if (outcome.pickedCalibrationId && input.carSetupSheetModelId) {
    const cal = await prisma.setupSheetCalibration.findFirst({
      where: { id: outcome.pickedCalibrationId },
      select: {
        setupSheetModelId: true,
        setupSheetModel: { select: { name: true } },
      },
    });
    const calModelId = cal?.setupSheetModelId?.trim() || null;
    const carModelId = input.carSetupSheetModelId.trim();
    if (calModelId && calModelId !== carModelId) {
      modelMismatch = true;
      const calModelName = cal?.setupSheetModel?.name ?? "another model";
      const carModelName = input.carSetupSheetModelName?.trim() || "this car’s sheet model";
      userNote = `Matched “${outcome.pickedCalibrationName}” (linked to ${calModelName}), but the car uses ${carModelName}. Confirm or pick another calibration.`;
    }
  }

  return { ...outcome, userNote, modelMismatch };
}

/**
 * After a fingerprint pick: link unlinked calibration to the car model, set model default if unset.
 */
export async function applyPostFingerprintPickLinks(input: {
  userId: string;
  pickedCalibrationId: string;
  carSetupSheetModelId?: string | null;
}): Promise<void> {
  const modelId = input.carSetupSheetModelId?.trim() || null;
  if (!modelId) return;

  const cal = await prisma.setupSheetCalibration.findFirst({
    where: { id: input.pickedCalibrationId, userId: input.userId },
    select: { id: true, setupSheetModelId: true },
  });
  if (!cal) return;

  if (!cal.setupSheetModelId) {
    await prisma.setupSheetCalibration.update({
      where: { id: cal.id },
      data: { setupSheetModelId: modelId },
    });
  }

  const model = await prisma.setupSheetModel.findFirst({
    where: { id: modelId, userId: input.userId },
    select: { defaultCalibrationId: true },
  });
  if (model && !model.defaultCalibrationId) {
    await prisma.setupSheetModel.update({
      where: { id: modelId },
      data: { defaultCalibrationId: cal.id },
    });
  }
}
