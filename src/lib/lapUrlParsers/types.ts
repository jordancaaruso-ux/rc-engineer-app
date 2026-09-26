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
    /** MYLAPS practice: the chip the run was timed on, and the label its owner gave that chip. */
    practiceTransponder?: string | null;
    practiceSiteName?: string | null;
    /** MYLAPS practice: the location's own name ("Arena33 DJK Onroad"). */
    practiceLocationName?: string | null;
  };
  /**
   * UTC ISO instant when the timing provider exposes session/run time on track
   * (e.g. LiveRC page title/body). Not the same as when the user imported the URL.
   */
  sessionCompletedAtIso?: string | null;
  /**
   * Speedhive practice only: the track's offset from UTC when the session ran (+02:00 → 120), read
   * off the loop's own timestamps. The one source that sends a real instant also says what the
   * track's clock showed, which is what lets two sites' copies of a race be matched on the track's
   * time wherever the driver is (`lapImport/trackClock.ts`).
   */
  sessionUtcOffsetMinutes?: number | null;
  /**
   * The address the app files this session under, when the link that was read is another
   * spelling of it (Speedhive's `/practice/<activity>/activity` for
   * `/practice/<location>/activities/<activity>`). The import stores this one, so a pasted link
   * and the same session found by URL Auto are one row.
   */
  canonicalUrl?: string | null;
  message?: string | null;
  /** Machine-readable failure (e.g. driver_not_found). */
  errorCode?: string;
  /** LiveRC event hub (`p=view_event`): child race result URLs discovered on the page (no laps on the hub itself). */
  discoveredRaceUrls?: string[];
  /**
   * MyRCM category (class) page: the labeled result sessions it contains (no laps on the category itself).
   * The user picks the one they raced; each `url` is a single-session import (`…?reportKey=<n>`).
   */
  discoveredSessions?: Array<{ url: string; label: string; group: string }>;
}

export type LapUrlParseContext = {
  /** Optional explicit driver override (e.g. user typed a name). */
  driverName?: string;
  /** Every name the driver appears under on Speedhive; any one matching is a hit. */
  speedhiveDriverNames?: string[];
  /**
   * Name(s) the driver appears under on MyRCM. MyRCM has no per-driver account or transponder in
   * its public results, so this is the only way to know which row in the field is theirs.
   */
  myRcmDriverNames?: string[];
  /** MYLAPS transponder numbers for Speedhive session row matching. */
  speedhiveTransponderNumbers?: number[];
};

export interface LapUrlParser {
  readonly id: string;
  canHandle(url: string): boolean;
  parse(url: string, context?: LapUrlParseContext): Promise<LapUrlParseResult>;
}
