import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildCalibrationFingerprints,
  repickCalibrationForBytes,
  type ChassisCandidate,
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
  /** Uploaded file name — a cheap disambiguation hint when the fingerprint spans >1 chassis. */
  originalFilename?: string | null;
  /** Setup-sheet-model ids of cars the uploader owns — the other cheap disambiguation hint. */
  uploaderModelIds?: readonly string[];
};

export type FingerprintPickResult = RepickOutcome & {
  /** Plain-language note for review UI / needsReviewReason. */
  userNote: string | null;
  modelMismatch: boolean;
  /** When PDF matches a different chassis type than selected. */
  detectedSheetModelId?: string | null;
  detectedSheetModelName?: string | null;
  /** True when the PDF matches >1 chassis and hints couldn't split them — ask the driver. */
  needsChassisDisambiguation?: boolean;
  /** The chassis models to offer as a tap-to-answer question when disambiguation is needed. */
  chassisCandidates?: ChassisCandidate[];
};

/** A model-name token (≥3 chars) appears in the file name, e.g. "MTC3_CW.pdf" → Mugen MTC3. */
function filenameHitsModel(filename: string | null | undefined, modelName: string): boolean {
  if (!filename?.trim()) return false;
  const fn = filename.toLowerCase();
  return modelName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
    .some((t) => fn.includes(t));
}

/**
 * Narrow cross-chassis fingerprint matches to a single chassis using cheap signals, without ever
 * silently guessing: an intersection of both signals wins; else a lone file-name hit; else a lone
 * garage match. Returns null when the signals can't split it (→ ask the driver).
 */
export function narrowChassisByHints(
  candidates: ChassisCandidate[],
  filename: string | null | undefined,
  uploaderModelIds: readonly string[] | undefined
): (ChassisCandidate & { basis: string }) | null {
  const garage = new Set((uploaderModelIds ?? []).map((s) => s.trim()).filter(Boolean));
  const byFilename = candidates.filter((c) => filenameHitsModel(filename, c.modelName));
  const byGarage = candidates.filter((c) => garage.has(c.modelId));
  const intersection = byFilename.filter((c) => garage.has(c.modelId));
  if (intersection.length === 1) return { ...intersection[0]!, basis: "file name + your garage" };
  if (byFilename.length === 1) return { ...byFilename[0]!, basis: "file name" };
  if (byGarage.length === 1) return { ...byGarage[0]!, basis: "your garage" };
  return null;
}

function chassisAskNote(models: ChassisCandidate[]): string {
  const names = models.map((m) => m.modelName);
  const list =
    names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
  return `This sheet's layout is shared by more than one chassis (${list}). Tell me which one it is and I'll import it correctly.`;
}

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
    // Fingerprint spans >1 chassis (e.g. MTC3 & A800RR share generic Text1..N fields). Try cheap
    // hints (file name, uploader's garage) before ever rendering a guess; else ask the driver.
    if (outcome.pickSource === "needs_disambiguation" && outcome.crossModelCandidates?.length) {
      const resolved = narrowChassisByHints(
        outcome.crossModelCandidates,
        input.originalFilename,
        input.uploaderModelIds
      );
      if (resolved) {
        const scoped = scopeCandidates(candidates, resolved.modelId, resolved.modelName);
        const scopedOutcome = await repickCalibrationForBytes(input.bytes, scoped, {
          debugPrefix: `${prefix}:disambig`,
          suggestOnAmbiguous: true,
        });
        if (scopedOutcome.pickedCalibrationId) {
          outcome = {
            ...scopedOutcome,
            pickDebug: `${prefix} disambiguated=${resolved.modelName} by ${resolved.basis} → ${scopedOutcome.pickDebug}`,
          };
        } else {
          // Resolved a chassis but couldn't land a calibration for it — fall back to asking.
          return {
            ...outcome,
            userNote: chassisAskNote(outcome.crossModelCandidates),
            modelMismatch: false,
            needsChassisDisambiguation: true,
            chassisCandidates: outcome.crossModelCandidates,
          };
        }
      } else {
        return {
          ...outcome,
          userNote: chassisAskNote(outcome.crossModelCandidates),
          modelMismatch: false,
          needsChassisDisambiguation: true,
          chassisCandidates: outcome.crossModelCandidates,
        };
      }
    }
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
