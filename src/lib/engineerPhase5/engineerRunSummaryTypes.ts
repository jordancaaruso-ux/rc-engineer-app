/** Deterministic Engineer Summary (no advisory tone in v2). */

export type EngineerLapMetricFlag = "improved" | "regressed" | "flat" | "unknown";

export type EngineerLapMetricOutcome = {
  current: number | null;
  reference: number | null;
  delta: number | null;
  flag: EngineerLapMetricFlag;
  /** When lap count is too low for the metric to be meaningful (e.g. avg top 15). */
  notMeaningful?: boolean;
};

export type EngineerSetupChangeRow = {
  key: string;
  label: string;
  before: string;
  after: string;
  rankReason: string;
  severity: string;
};

export type EngineerRunSummaryV2 = {
  version: 2;
  currentRunId: string;
  referenceRunId: string | null;
  /** Human label for reference, e.g. session + date */
  referenceLabel: string | null;
  lapOutcome: {
    best: EngineerLapMetricOutcome;
    avgTop5: EngineerLapMetricOutcome;
    avgTop10: EngineerLapMetricOutcome;
    avgTop15: EngineerLapMetricOutcome;
    /** Higher score = more consistent (CV-based). */
    consistencyScore: EngineerLapMetricOutcome;
  };
  lapCountIncluded: { current: number; reference: number | null };
  setupChanges: EngineerSetupChangeRow[];
  interpretation: string;
  notesUsed: { verbatimSnippet: string | null; role: "none" | "context_only" };
  /** One-line import provenance when linked session exists */
  importedProvenance: string | null;
  /**
   * When this run has ≥2 imported lap sets (same session), rank / gap / fade vs session best.
   * `fieldFingerprint` invalidates cached JSON when imports change.
   */
  fieldImportSession: null | {
    sessionBestLapSeconds: number | null;
    ranked: Array<{
      label: string;
      isPrimaryUser: boolean;
      rank: number;
      bestLapSeconds: number | null;
      gapToSessionBestSeconds: number | null;
      fadeSeconds: number | null;
    }>;
  };
  fieldFingerprint: string;
  deepDiveOffered: boolean;
  /** Soft historical context (Phase 4); never strong claims */
  softPriors: string[];
};

export const ENGINEER_DEEP_DIVE_VERSION = 1 as const;

export type EngineerDeepDiveAnswersV1 = {
  version: typeof ENGINEER_DEEP_DIVE_VERSION;
  dominantIssue: string;
  severityFeel: "mild" | "moderate" | "severe";
  feelVsPrior: string;
  freeText?: string;
  completedAtIso: string;
  referenceRunId: string | null;
};
