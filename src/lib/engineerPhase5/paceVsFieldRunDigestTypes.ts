/** Account-level digest of runs with meaningful avg top 10 vs session field mean (for Engineer chat). */

export type PaceVsFieldRunDigestRowV1 = {
  runId: string;
  /** ISO instant for sorting / display (run display instant). */
  sortIso: string;
  /** UTC calendar date YYYY-MM-DD from display instant (grouping; not local wall clock). */
  displayDay: string;
  carId: string | null;
  carName: string;
  trackName: string;
  eventId: string | null;
  eventName: string | null;
  sessionSummary: string;
  /** Linked timing import id (multiple runs may share one session). */
  importedLapTimeSessionId: string | null;
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

/** Max rows client may send in paceVsFieldRunDigestSubset (chat token budget). */
export const PACE_VS_FIELD_DIGEST_SUBSET_MAX_ROWS = 32;

/** User-chosen slice of a digest for chat (deterministic; built client-side). */
export type PaceVsFieldRunDigestSubsetV1 = {
  version: 1;
  generatedAtIso: string;
  /** Matches parent PaceVsFieldRunDigestV1.generatedAtIso when subset was built from that load. */
  parentDigestGeneratedAtIso: string;
  /** Short human label, e.g. "NSW State Titles · Moorebank · 6 runs". */
  filterSummary: string;
  metric: "avg_top_10_vs_field_mean";
  gapMeaning: "user_seconds_minus_field_mean_positive_slower";
  rows: PaceVsFieldRunDigestRowV1[];
};
