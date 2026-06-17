import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildCalibrationFingerprints,
  repickCalibrationForBytes,
  type RepickOutcome,
} from "@/lib/setupCalibrations/autoPickCalibration";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";
import { scopeCandidatesForModel } from "@/lib/setupCalibrations/scopeCandidates";

export type FingerprintPickContext = {
  userId: string;
  bytes: Uint8Array;
  debugPrefix?: string;
  /** Target setup sheet model (chassis type) — fingerprint is scoped here first. */
  carSetupSheetModelId?: string | null;
  carSetupSheetModelName?: string | null;
};

export type FingerprintPickResult = RepickOutcome & {
  /** Plain-language note for review UI / needsReviewReason. */
  userNote: string | null;
  modelMismatch: boolean;
  /** When PDF matches a different chassis type than selected. */
  detectedSheetModelId?: string | null;
  detectedSheetModelName?: string | null;
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
 * Calibrations usable for the selected chassis type:
 *  - linked to exactly this model id, OR
 *  - unlinked (no model) — generic calibrations apply to any chassis, and we
 *    link them on a successful pick via {@link applyPostFingerprintPickLinks}, OR
 *  - linked to a *duplicate* model row with the same normalized name (e.g. a
 *    second "Mugen MTC3" created by a repeat wizard run).
 *
 * The same-name and unlinked cases are what `67b1f8e` accidentally excluded,
 * which broke Mugen uploads when the matching calibration lived under a
 * duplicate model row or had no model link yet.
 */
function scopeCandidates(
  candidates: Awaited<ReturnType<typeof buildCalibrationFingerprints>>,
  modelId: string,
  modelName: string | null
) {
  return scopeCandidatesForModel(candidates, modelId, modelName);
}

function outcomeFromGlobalMismatch(
  prefix: string,
  global: RepickOutcome,
  candidates: Awaited<ReturnType<typeof buildCalibrationFingerprints>>,
  targetModelId: string,
  targetModelName: string
): FingerprintPickResult | null {
  if (!global.pickedCalibrationId) return null;
  const matched = candidates.find((c) => c.calibrationId === global.pickedCalibrationId);
  const detectedId = matched?.setupSheetModelId?.trim() || null;
  const detectedName = matched?.setupSheetModelName?.trim() || null;
  if (!detectedId || detectedId === targetModelId) return null;

  const label = detectedName ?? "another chassis type";
  return {
    pickedCalibrationId: null,
    pickedCalibrationName: null,
    pickSource: "none",
    pickDebug: `${prefix} wrong_model detected=${label} target=${targetModelName}`,
    userNote: `This PDF matches the ${label} setup sheet, not ${targetModelName}. Add a ${label} car or pick the correct calibration below.`,
    modelMismatch: true,
    detectedSheetModelId: detectedId,
    detectedSheetModelName: detectedName,
  };
}

/**
 * Pick calibration by AcroForm fingerprint. When a target sheet model is set, only auto-pick
 * calibrations for that chassis; cross-model matches become a mismatch hint (no A800 default).
 */
export async function pickCalibrationByFingerprint(
  input: FingerprintPickContext
): Promise<FingerprintPickResult> {
  const prefix = input.debugPrefix ?? "auto";
  const candidates = await buildCalibrationFingerprints({ userId: input.userId });
  const targetModelId = input.carSetupSheetModelId?.trim() || null;
  const targetModelNameRaw = input.carSetupSheetModelName?.trim() || null;
  const targetModelName = targetModelNameRaw ?? "this chassis type";

  let outcome: RepickOutcome;
  if (targetModelId) {
    const scoped = scopeCandidates(candidates, targetModelId, targetModelNameRaw);
    outcome = await repickCalibrationForBytes(input.bytes, scoped, {
      debugPrefix: `${prefix}:scoped`,
      suggestOnAmbiguous: false,
    });

    if (outcome.pickSource === "none") {
      const global = await repickCalibrationForBytes(input.bytes, candidates, {
        debugPrefix: `${prefix}:global`,
        suggestOnAmbiguous: false,
      });
      const mismatch = outcomeFromGlobalMismatch(
        prefix,
        global,
        candidates,
        targetModelId,
        targetModelName
      );
      if (mismatch) return mismatch;

      if (scoped.length === 0) {
        return {
          ...outcome,
          userNote: `No calibration exists yet for ${targetModelName}. Finish the car wizard with an example PDF, or map fields manually.`,
          modelMismatch: false,
        };
      }
    }
  } else {
    outcome = await repickCalibrationForBytes(input.bytes, candidates, {
      debugPrefix: prefix,
      suggestOnAmbiguous: true,
    });
  }

  let modelMismatch = false;
  let userNote = humanPickNote(outcome);
  let detectedSheetModelId: string | null = null;
  let detectedSheetModelName: string | null = null;

  if (outcome.pickedCalibrationId && targetModelId) {
    const cal = await prisma.setupSheetCalibration.findFirst({
      where: { id: outcome.pickedCalibrationId },
      select: {
        setupSheetModelId: true,
        setupSheetModel: { select: { name: true } },
      },
    });
    const calModelId = cal?.setupSheetModelId?.trim() || null;
    // Only a genuinely different *chassis* (different normalized name) is a
    // mismatch. Unlinked calibrations (null model) and same-name duplicate
    // model rows are valid for this chassis and are linked post-pick.
    const calName = cal?.setupSheetModel?.name ?? null;
    const sameChassisByName = Boolean(
      calName &&
        targetModelNameRaw &&
        normalizeSetupSheetModelName(calName) === normalizeSetupSheetModelName(targetModelNameRaw)
    );
    if (calModelId && calModelId !== targetModelId && !sameChassisByName) {
      modelMismatch = true;
      detectedSheetModelId = calModelId;
      detectedSheetModelName = calName;
      const calModelName = detectedSheetModelName ?? "another model";
      userNote = `Matched “${outcome.pickedCalibrationName}” (${calModelName}), but you selected ${targetModelName}. Confirm or pick another calibration.`;
      outcome = {
        pickedCalibrationId: null,
        pickedCalibrationName: null,
        pickSource: "none",
        pickDebug: `${prefix} model_mismatch cal=${calModelName}`,
      };
    }
  }

  return {
    ...outcome,
    userNote,
    modelMismatch,
    detectedSheetModelId,
    detectedSheetModelName,
  };
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

  const model = await prisma.setupSheetModel.findUnique({
    where: { id: modelId },
    select: { defaultCalibrationId: true },
  });
  if (model && !model.defaultCalibrationId) {
    await prisma.setupSheetModel.update({
      where: { id: modelId },
      data: { defaultCalibrationId: cal.id },
    });
  }
}
