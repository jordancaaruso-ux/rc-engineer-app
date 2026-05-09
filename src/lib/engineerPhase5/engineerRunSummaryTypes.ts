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

/** One row of “you vs session field average” for a single lap metric. */
export type PaceVsFieldMetricId = "best" | "avg_top_5" | "avg_top_10" | "avg_top_15";

export type PaceVsFieldMetricSnapshotV1 = {
  metric: PaceVsFieldMetricId;
  label: string;
  /** Arithmetic mean of this metric across entrants with a finite value. */
  fieldMeanSeconds: number | null;
  userSeconds: number | null;
  /** User minus field mean; positive ⇒ slower than the session average. */
  gapUserMinusFieldMeanSeconds: number | null;
  /** 1 = best (lowest time) among entrants with a finite value for this metric. */
  rankInField: number | null;
  fieldEntrantCountForMetric: number;
  meaningful: boolean;
};

/** Session-level aggregates from linked `ImportedLapTimeSession.fieldStatsJson` (full parsed field). */
export type ImportedSessionFieldStatsEngineerCompactV1 = {
  version: 1;
  driverCount: number;
  /** Min best lap among entrants with a valid best (session “pole”). */
  sessionBestBestLapSeconds: number | null;
  /** Min avg-top-5 among entrants with a valid average (pseudo session best sustained). */
  sessionBestAvgTop5Seconds: number | null;
  sessionBestAvgTop10Seconds: number | null;
  fieldMedianBestSeconds: number | null;
  fieldMedianAvgTop5Seconds: number | null;
  /**
   * Per-metric: session field **mean** vs your value, gap, and rank (when multi-driver aggregates exist).
   * Null when fewer than two drivers or your row is unmatched.
   */
  paceVsFieldMeanAnalysis: PaceVsFieldMetricSnapshotV1[] | null;
  /**
   * Your row inferred from imported lap sets flagged `isPrimaryUser`, or lone driver fallback.
   * Gaps vs session-best columns (**positive ⇒ you slower**) when both sides finite.
   */
  matchedYou: null | {
    label: string;
    rankByBest: number | null;
    bestLapSeconds: number | null;
    avgTop5Seconds: number | null;
    avgTop10Seconds: number | null;
    gapBestToSessionBestSeconds: number | null;
    gapAvgTop5ToSessionBestAvg5Seconds: number | null;
    gapAvgTop10ToSessionBestAvg10Seconds: number | null;
  };
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
  /**
   * When the run links an `ImportedLapTimeSession` with stored aggregates: best / avgTop5 / avgTop10
   * vs session-best columns for the matched driver. Complements `fieldImportSession` (lap-set rows + fade).
   */
  importedSessionFieldStats: ImportedSessionFieldStatsEngineerCompactV1 | null;
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
