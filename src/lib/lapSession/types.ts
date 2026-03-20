/**
 * Versioned lap session blob stored on Run.lapSession.
 * Primary laps are always duplicated in Run.lapTimes for backward compatibility and simple queries.
 */

export const LAP_SESSION_VERSION = 1 as const;

/** How laps were brought into the run (MVP: manual, screenshot, url stub; csv reserved). */
export type LapSourceKind = "manual" | "screenshot" | "url" | "csv";

/**
 * Who this lap list belongs to relative to the logging user.
 * Future: field / teammate / competitor rows for session-level compare.
 */
export type LapDriverRole = "primary" | "teammate" | "competitor" | "field_reference";

export interface LapMetrics {
  bestLap: number | null;
  /** Mean of the fastest up to 5 laps (or fewer if under 5 laps). */
  averageTop5: number | null;
  lapCount: number;
}

export interface LapEntry {
  role: LapDriverRole;
  /** Display name when known (OCR, results page, manual label). */
  driverName?: string | null;
  className?: string | null;
  laps: number[];
  /** Optional denormalized; can be recomputed from laps. */
  metrics?: LapMetrics;
}

export interface LapSessionContext {
  sessionLabel?: string | null;
  eventId?: string | null;
  eventName?: string | null;
  /** Future: heat / round / round index from timing systems */
  sessionHeatId?: string | null;
}

export interface LapSessionSource {
  kind: LapSourceKind;
  /** Human-readable: filename, pasted URL, etc. */
  detail?: string | null;
  /** Registered parser id when kind === "url". */
  parserId?: string | null;
}

export interface LapSessionV1 {
  version: typeof LAP_SESSION_VERSION;
  source: LapSessionSource;
  entries: LapEntry[];
  /** Summary for the primary entry / whole session (same as primary when single entry). */
  metrics?: LapMetrics;
  context?: LapSessionContext;
}
