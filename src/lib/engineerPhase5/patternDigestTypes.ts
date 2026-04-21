/** Client-safe types for pattern digest (avoid importing server-only modules in UI). */

export type PatternDigestRunRow = {
  runId: string;
  sortIso: string;
  carId: string | null;
  carName: string;
  trackName: string;
  eventName: string | null;
  lapSummary: {
    lapCount: number;
    bestLapSeconds: number | null;
    avgTop5Seconds: number | null;
    avgTop10Seconds: number | null;
    consistencyScore: number | null;
  };
  setupKeysChangedFromPrevious: string[] | null;
  notesPreview: string | null;
};

export type PatternDigestV1 = {
  version: 1;
  generatedAtIso: string;
  carId: string;
  filters: {
    eventId: string | null;
    trackId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  };
  runs: PatternDigestRunRow[];
  highlight: {
    bestLapRunId: string | null;
    bestLapSeconds: number | null;
  };
};
