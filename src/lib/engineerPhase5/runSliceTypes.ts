import type { PatternDigestRunRow } from "@/lib/engineerPhase5/patternDigestTypes";

/** Client-safe: filtered account run detail (digest-shaped rows). */

export type RunSliceV1 = {
  version: 1;
  generatedAtIso: string;
  filters: {
    carId: string | null;
    trackId: string | null;
    eventId: string | null;
    dateFrom: string | null;
    dateTo: string | null;
    limit: number;
  };
  runs: PatternDigestRunRow[];
  highlight: { bestLapRunId: string | null; bestLapSeconds: number | null };
};
