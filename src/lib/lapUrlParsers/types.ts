/**
 * Result of parsing a remote timing/results URL.
 * Parsers are registered by id; the registry picks one by canHandle(url).
 */

export interface LapUrlParseResult {
  /** Stable id, e.g. "stub", "livetime-future". */
  parserId: string;
  /** Candidate laps for the selected driver row (MVP: often empty until parsers exist). */
  laps: number[];
  /** Optional multi-row preview for confirmation UI (teammates / field later). */
  candidates?: Array<{
    id: string;
    label: string;
    laps: number[];
    roleHint?: "primary" | "teammate" | "competitor" | "unknown";
  }>;
  sessionHint?: {
    name?: string | null;
    className?: string | null;
  };
  message?: string | null;
}

export interface LapUrlParser {
  readonly id: string;
  canHandle(url: string): boolean;
  parse(url: string): Promise<LapUrlParseResult>;
}
