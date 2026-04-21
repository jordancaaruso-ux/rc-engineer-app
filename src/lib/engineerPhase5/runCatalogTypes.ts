/** Client-safe types for account run catalog (inventory for Engineer chat). */

export type RunCatalogRow = {
  runId: string;
  /** Wall-time instant used for sorting (session completed when known, else created). */
  sortIso: string;
  carId: string | null;
  carName: string;
  trackName: string;
  eventName: string | null;
  sessionSummary: string;
  lapCount: number;
  bestLapSeconds: number | null;
};

export type RunCatalogV1 = {
  version: 1;
  generatedAtIso: string;
  /** Total runs owned by the user (before row cap). */
  totalRunCount: number;
  /** Rows included in `rows` (after cap). */
  includedRunCount: number;
  /** True when totalRunCount > includedRunCount. */
  truncated: boolean;
  omittedCount: number;
  rows: RunCatalogRow[];
};
