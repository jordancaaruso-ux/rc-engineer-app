/** Account-level digest of runs with meaningful avg top 10 vs session field mean (for Engineer chat). */

export type PaceVsFieldRunDigestRowV1 = {
  runId: string;
  /** ISO instant for sorting / display (run display instant). */
  sortIso: string;
  carId: string | null;
  carName: string;
  trackName: string;
  eventName: string | null;
  sessionSummary: string;
  avgTop10UserSeconds: number;
  avgTop10FieldMeanSeconds: number;
  /** user minus field arithmetic mean; negative = faster than field average. */
  gapUserMinusFieldMeanSeconds: number;
  rankInField: number | null;
  fieldEntrantCountForMetric: number;
  sessionDriverCount: number;
};

export type PaceVsFieldRunDigestV1 = {
  version: 1;
  generatedAtIso: string;
  /** Rows sorted by gap ascending (best vs field mean first). */
  metric: "avg_top_10_vs_field_mean";
  gapMeaning: "user_seconds_minus_field_mean_positive_slower";
  scope: "account" | "car";
  /** When scope is car, car id used to filter runs. */
  scopeCarId: string | null;
  anchorRunId: string | null;
  scannedRunCount: number;
  includedRunCount: number;
  /** Runs with linked timing that had meaningful avg top 10 vs mean but were dropped after cap. */
  omittedAfterCap: number;
  /** More runs with importedLapTimeSessionId exist than were scanned. */
  truncatedScan: boolean;
  rows: PaceVsFieldRunDigestRowV1[];
};
