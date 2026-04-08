/**
 * Result of parsing a remote timing/results URL.
 * Parsers are registered by id; the registry picks one by canHandle(url).
 */

/** One lap from URL import (e.g. LiveRC) with optional warnings / user flags. */
export interface LapImportLapRow {
  time: number;
  isOutlierWarning?: boolean;
  warningReason?: string | null;
  isFlagged?: boolean;
  flagReason?: string | null;
  /** LiveRC practice: lap line had trailing * in source HTML (informational only; not used to exclude). */
  liveRcPracticeStarred?: boolean;
}

export interface LapUrlSessionDriver {
  id: string;
  driverId: string;
  driverName: string;
  normalizedName: string;
  laps: number[];
  lapCount?: number;
}

export interface LapUrlParseResult {
  /** Stable id, e.g. "stub", "livetime-future". */
  parserId: string;
  /** Candidate laps for the selected driver row (MVP: often empty until parsers exist). */
  laps: number[];
  /** When present (e.g. LiveRC race result), prefer for UI: warnings and per-lap flags. */
  lapRows?: LapImportLapRow[];
  /** Optional multi-row preview for confirmation UI (teammates / field later). */
  candidates?: Array<{
    id: string;
    label: string;
    laps: number[];
    roleHint?: "primary" | "teammate" | "competitor" | "unknown";
  }>;
  /** Optional full session participants (e.g. LiveRC race result). */
  sessionDrivers?: LapUrlSessionDriver[];
  sessionHint?: {
    name?: string | null;
    className?: string | null;
  };
  /**
   * UTC ISO instant when the timing provider exposes session/run time on track
   * (e.g. LiveRC page title/body). Not the same as when the user imported the URL.
   */
  sessionCompletedAtIso?: string | null;
  message?: string | null;
  /** Machine-readable failure (e.g. driver_not_found). */
  errorCode?: string;
}

export type LapUrlParseContext = {
  /** Optional explicit driver override (e.g. user typed a name). */
  driverName?: string;
};

export interface LapUrlParser {
  readonly id: string;
  canHandle(url: string): boolean;
  parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult>;
}
