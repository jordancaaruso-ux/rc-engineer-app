import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";

/** Minimal shape needed to decide whether a calibration applies to a chassis. */
export type ScopeCandidate = {
  setupSheetModelId: string | null;
  setupSheetModelName: string | null;
};

/**
 * True when a calibration candidate is usable for the selected chassis type:
 *  - linked to exactly this model id, OR
 *  - unlinked (no model) — generic calibrations apply to any chassis and are
 *    linked on a successful pick, OR
 *  - linked to a *duplicate* model row with the same normalized name (e.g. a
 *    second "Mugen MTC3" created by a repeat wizard run).
 *
 * The same-name and unlinked cases are what a prior change accidentally excluded,
 * breaking Mugen uploads when the matching calibration lived under a duplicate
 * model row or had no model link yet.
 */
export function isCandidateInScopeForModel(
  candidate: ScopeCandidate,
  modelId: string,
  modelName: string | null
): boolean {
  if (candidate.setupSheetModelId === modelId) return true;
  if (!candidate.setupSheetModelId) return true;
  const targetNorm = modelName ? normalizeSetupSheetModelName(modelName) : null;
  if (targetNorm && candidate.setupSheetModelName) {
    return normalizeSetupSheetModelName(candidate.setupSheetModelName) === targetNorm;
  }
  return false;
}

/** Filter candidates down to those in scope for the given chassis model. */
export function scopeCandidatesForModel<T extends ScopeCandidate>(
  candidates: T[],
  modelId: string,
  modelName: string | null
): T[] {
  return candidates.filter((c) => isCandidateInScopeForModel(c, modelId, modelName));
}
