/** Payload stored in `EngineerBetweenRunHint.payloadJson` and returned to clients. */

import type { EngineerLapMetricFlag, PaceVsFieldMetricSnapshotV1 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

export type BetweenRunHintSignal =
  | "lap_regressed"
  | "lap_improved"
  | "feel_worse"
  | "feel_better"
  | "meaningful_setup_change"
  | "low_lap_data";

export type BetweenRunHintScopeV1 = {
  eventId: string | null;
  eventLabel: string | null;
  carId: string;
  carLabel: string;
  trackId: string | null;
  trackLabel: string | null;
};

/** @deprecated Stored rows may still be v1; server migrates reads to v2. */
export type BetweenRunHintPayloadV1 = {
  version: 1;
  scope: BetweenRunHintScopeV1;
  basedOnRunIds: { primary: string; reference: string | null };
  signals: BetweenRunHintSignal[];
  headline: string;
  bullets: string[];
  /** Non-empty when regression aligns with setup changes; otherwise null. */
  avoidRepeating: string | null;
  sourcesNote: string;
  /** Deep link to Engineer with this pair pre-selected. */
  engineerHref: string;
};

/** Newest session first (up to three on the same car reference chain). */
export type BetweenRunRecentSessionSnapshotV1 = {
  runId: string;
  displayLabel: string;
  bestLapSeconds: number | null;
  /** vs your prior session on this car when a reference exists for that run. */
  bestLapVsPreviousFlag: EngineerLapMetricFlag | null;
  /** Present for payloads built after this panel shipped; older rows may omit. */
  avgTop5LapSeconds?: number | null;
  avgTop10LapSeconds?: number | null;
  /** When the run lacks enough laps for that aggregate (same rule as lap summary). */
  avgTop5NotMeaningful?: boolean;
  avgTop10NotMeaningful?: boolean;
  avgTop5VsPreviousFlag?: EngineerLapMetricFlag | null;
  avgTop10VsPreviousFlag?: EngineerLapMetricFlag | null;
  /** Multi-line text for LLM (includes vs field mean when available). */
  paceVsFieldSummary: string | null;
  /** Structured pace vs session field average; absent on older cached hint payloads. */
  paceVsFieldMetrics?: PaceVsFieldMetricSnapshotV1[] | null;
  setupChangesFromPrevious: string[];
  notesPreview: string | null;
  handlingPreview: string | null;
};

export type BetweenRunHintPayloadV2 = {
  version: 2;
  scope: BetweenRunHintScopeV1;
  basedOnRunIds: { primary: string; reference: string | null };
  signals: BetweenRunHintSignal[];
  headline: string;
  bullets: string[];
  avoidRepeating: string | null;
  sourcesNote: string;
  engineerHref: string;
  recentSessions: BetweenRunRecentSessionSnapshotV1[];
  driverContextPack: {
    combinedNotesAndHandling: string;
    currentSetupLines: string[];
  };
};

/** Normalized payload returned by API / peek after migration from v1. */
export type BetweenRunHintPayload = BetweenRunHintPayloadV2;

/** Fingerprint slice for recent-session rows (stable JSON via buildBetweenRunHintFingerprint). */
export type RecentSessionsFingerprintMaterial = {
  runIds: string[];
  perRun: Array<{
    runId: string;
    fieldFingerprint: string;
    bestFlag: string | null;
    setupSig: string[];
    paceLine: string | null;
    /** Stable digest of pace-vs-field mean rows for cache invalidation. */
    paceMetricsSig: string | null;
    /** Avg-top-5/10 values + flags for cache invalidation when recent-session cards change. */
    lapMultiSig: string | null;
  }>;
};
