import { createHash } from "node:crypto";

function stableReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

export function buildDashboardSuggestionFingerprint(params: {
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  handlingAssessmentJson: unknown;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  setupSnapshotId: string;
  priorRunId: string | null;
  priorSetupSnapshotId: string | null;
  /** Compact digest of setup-vs-spread rows (keys + bands + display). */
  spreadMaterial: unknown;
  /** Engineer summary field fingerprint when summary exists; else null. */
  engineerSummaryFieldFingerprint: string | null;
  setupOutcomeMemoryFingerprint?: string | null;
  /** Shared engineering-brain fingerprint (read + known-good + analogies). */
  engineeringBrainFingerprint?: string | null;
  /** Required 1-10 car rating; invalidates cache when the driver re-rates the run. */
  carRating?: number | null;
}): string {
  const payload = {
    v: 7 as const,
    notes: params.notes,
    driverNotes: params.driverNotes,
    handlingProblems: params.handlingProblems,
    handling: params.handlingAssessmentJson ?? null,
    suggestedChanges: params.suggestedChanges,
    appliedChanges: params.appliedChanges,
    setupSnapshotId: params.setupSnapshotId,
    priorRunId: params.priorRunId,
    priorSetupSnapshotId: params.priorSetupSnapshotId,
    spread: params.spreadMaterial,
    summaryFp: params.engineerSummaryFieldFingerprint,
    setupOutcomeMemoryFp: params.setupOutcomeMemoryFingerprint ?? null,
    brainFp: params.engineeringBrainFingerprint ?? null,
    carRating: params.carRating ?? null,
  };
  const json = JSON.stringify(payload, stableReplacer);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
