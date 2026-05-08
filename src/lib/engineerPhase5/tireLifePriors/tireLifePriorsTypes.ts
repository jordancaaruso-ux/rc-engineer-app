export type TireLifeConfidence = "low" | "medium" | "high";

/** One step k → k+1 on the same tire set from the user’s history. */
export type TireLifeStepAggV1 = {
  fromTireRun: number;
  toTireRun: number;
  pairCount: number;
  confidence: TireLifeConfidence;
  /**
   * Median (toRun − fromRun) in seconds. Positive ⇒ slower / typical degradation pacing.
   * Null when no valid samples for that metric (e.g. not enough laps for avgTop15).
   */
  bestLapDeltaMedianSeconds: number | null;
  avgTop5DeltaMedianSeconds: number | null;
  avgTop10DeltaMedianSeconds: number | null;
  avgTop15DeltaMedianSeconds: number | null;
};

export type TireLifeFocusedCompareNudgeV1 = {
  compareTireRun: number;
  primaryTireRun: number;
  totalSteps: number;
  /** Steps where that metric had a median (pair met lap-count gates). */
  stepsWithDataBest: number;
  stepsWithDataAvgTop5: number;
  stepsWithDataAvgTop10: number;
  stepsWithDataAvgTop15: number;
  /** Sum of per-step medians along compare→primary chain (missing steps skipped). */
  summedBestDeltaMedianSeconds: number | null;
  summedAvgTop5DeltaMedianSeconds: number | null;
  summedAvgTop10DeltaMedianSeconds: number | null;
  summedAvgTop15DeltaMedianSeconds: number | null;
};

export type TireLifePriorsV1 = {
  version: 1;
  tireSetId: string;
  tireSetLabel: string | null;
  anchorTrackId: string | null;
  anchorTrackName: string | null;
  /** Consecutive (k→k+1) pairs with both runs at anchor track (when anchor has a track). */
  atAnchorTrack: TireLifeStepAggV1[];
  /** Consecutive pairs on this tire set, any track. */
  allYourTracksOnSet: TireLifeStepAggV1[];
  /**
   * When URL focused pair compares two runs on the same tire set with primary.tireRun > compare.tireRun,
   * rough expected pace shift from tire-index steps alone (sum of step medians).
   */
  focusedCompareNudge: TireLifeFocusedCompareNudgeV1 | null;
};

/** One event×track bucket: pooled 1→2 tire-run pace deltas across several tire sets (resolved search scope). */
export type ResolvedScopeTireStepBucketV1 = {
  eventId: string | null;
  eventName: string | null;
  trackId: string | null;
  trackName: string | null;
  pairCount: number;
  distinctTireSetCount: number;
  confidence: TireLifeConfidence;
  bestLapDeltaMedianSeconds: number | null;
  avgTop5DeltaMedianSeconds: number | null;
  avgTop10DeltaMedianSeconds: number | null;
  avgTop15DeltaMedianSeconds: number | null;
  examplePairs: Array<{
    fromRunId: string;
    toRunId: string;
    tireSetId: string;
    tireSetLabel: string | null;
  }>;
};

export type ResolvedScopeTireStepsV1 = {
  version: 1;
  /** Substring filter on tire set label when used; else null. */
  tireLabelFilter: string | null;
  buckets: ResolvedScopeTireStepBucketV1[];
};
