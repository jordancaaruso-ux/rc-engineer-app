/**
 * LiveRC practice session page: /practice/?p=view_session&id=...
 * Lap list is server-rendered under a "Lap Times" heading (not the laptimes graph).
 * All lap lines are imported; trailing * is metadata only (not used to exclude).
 */

import { load } from "cheerio";
import type { LapImportLapRow, LapUrlParseResult, LapUrlSessionDriver } from "./types";
import { fetchUrlText } from "./fetchText";
import {
  extractLiveRcPracticeSessionWhenRaw,
  parseLiveRcSessionDisplayTimeToUtcIso,
} from "./livercSessionTime";

export const LIVERC_PRACTICE_PARSER_ID = "liverc_practice_session_v1";

const LOG_PREFIX = "[liveRc-practice-session]";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeNameKey(s: string): string {
  return normalizeWhitespace(s).toLowerCase();
}

/** Strict LiveRC practice-session URL; query param order is irrelevant (URLSearchParams). */
export function isLiveRcPracticeSessionUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path.endsWith("/practice")) return false;
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    const id = u.searchParams.get("id");
    return p === "view_session" && Boolean(id?.trim());
  } catch {
    return false;
  }
}

/** Match "Lap 12: 17.7" or "Lap 3: 17.298*" (star optional, any trailing * on line). */
const LAP_LINE_RE = /Lap\s+(\d+)\s*:\s*([0-9]+(?:[.,][0-9]+)?)(\s*\*)?/gi;

function parseLapTimeSeconds(raw: string): number | null {
  const v = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  if (v < 3 || v > 240) return null;
  return v;
}

/**
 * Isolate text after the "Lap Times" heading and before graph/footnote blocks
 * so summary stats (Fastest Lap, Avg, etc.) are less likely to appear in the slice.
 */
export function extractLapTimesSectionText(pageText: string): string | null {
  const normalized = normalizeWhitespace(pageText);
  const marker = /\bLap\s+Times\b/i;
  const found = marker.exec(normalized);
  if (!found || found.index === undefined) return null;
  const rest = normalized.slice(found.index);
  const endMarkers = [/\bLap-by-Lap\s+Graph\b/i, /\*\s*indicates\s+an\s+invalid\s+lap/i];
  let end = rest.length;
  for (const em of endMarkers) {
    em.lastIndex = 0;
    const hit = em.exec(rest);
    if (hit?.index != null && hit.index > 0 && hit.index < end) end = hit.index;
  }
  return rest.slice(0, end);
}

export type ParsedPracticeLapLine = {
  lapNumber: number;
  lapTimeSeconds: number;
  liveRcPracticeStarred: boolean;
};

export function parsePracticeLapLinesFromSectionText(sectionText: string): ParsedPracticeLapLine[] {
  const raw: ParsedPracticeLapLine[] = [];
  LAP_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LAP_LINE_RE.exec(sectionText)) !== null) {
    const lapNumber = Number.parseInt(m[1]!, 10);
    const timeStr = m[2]!;
    const starred = Boolean(m[3]?.includes("*"));
    const lapTimeSeconds = parseLapTimeSeconds(timeStr);
    if (!Number.isFinite(lapNumber) || lapNumber < 1 || lapTimeSeconds == null) continue;
    raw.push({ lapNumber, lapTimeSeconds, liveRcPracticeStarred: starred });
  }
  if (raw.length === 0) return [];

  const byLap = new Map<number, ParsedPracticeLapLine>();
  for (const row of raw) {
    byLap.set(row.lapNumber, row);
  }
  const ordered = [...byLap.keys()].sort((a, b) => a - b).map((k) => byLap.get(k)!);
  return ordered;
}

function extractSessionMeta(html: string): { driverName: string; className: string | null } {
  const $ = load(html);
  const title = normalizeWhitespace($("title").text());
  let driverName = "Practice session";
  const tm = title.match(/Practice\s+Session\s+for\s+(.+?)\s+on\s+/i);
  if (tm) driverName = normalizeWhitespace(tm[1]!);

  const body = normalizeWhitespace($("body").text());
  const cm =
    body.match(/\bClass\s*\|\s*([^|]+?)\s*\|/i) ??
    body.match(/\bClass\s*[|]\s*([^|]+?)\s*[|]/i) ??
    body.match(/\bClass\s+([^\n|]+?)(?:\n|\s+Transponder\b)/i);
  const className = cm ? normalizeWhitespace(cm[1]!) : null;
  return { driverName, className };
}

function toLapImportRows(lines: ParsedPracticeLapLine[]): LapImportLapRow[] {
  return lines.map((row) => ({
    time: row.lapTimeSeconds,
    isOutlierWarning: false,
    warningReason: null,
    isFlagged: false,
    flagReason: null,
    liveRcPracticeStarred: row.liveRcPracticeStarred ? true : undefined,
  }));
}

/**
 * Parse server-rendered practice HTML into the same `LapUrlParseResult` shape as race import.
 */
export function parseLiveRcPracticeSession(html: string, url: string): LapUrlParseResult {
  const pageText = normalizeWhitespace(load(html)("body").text());
  const section = extractLapTimesSectionText(pageText);
  if (!section) {
    return {
      parserId: LIVERC_PRACTICE_PARSER_ID,
      laps: [],
      candidates: [],
      message: 'Could not find a "Lap Times" section on this LiveRC practice page.',
      errorCode: "practice_lap_times_section_missing",
      sessionHint: { name: null, className: null },
    };
  }

  const lines = parsePracticeLapLinesFromSectionText(section);
  if (lines.length === 0) {
    return {
      parserId: LIVERC_PRACTICE_PARSER_ID,
      laps: [],
      candidates: [],
      message: "No lap lines matching “Lap N: time” were found under Lap Times.",
      errorCode: "practice_lap_lines_missing",
      sessionHint: { name: null, className: null },
    };
  }

  const { driverName, className } = extractSessionMeta(html);
  const titleText = normalizeWhitespace(load(html)("title").text());
  const whenRaw = extractLiveRcPracticeSessionWhenRaw(titleText);
  const sessionCompletedAtIso = whenRaw ? parseLiveRcSessionDisplayTimeToUtcIso(whenRaw) : null;
  const laps = lines.map((l) => l.lapTimeSeconds);
  const lapRows = toLapImportRows(lines);
  const normalizedName = normalizeNameKey(driverName);

  const sessionDriver: LapUrlSessionDriver = {
    id: "liverc-practice-session",
    driverId: "liverc_practice_session",
    driverName,
    normalizedName,
    laps,
    lapCount: laps.length,
  };

  console.info(LOG_PREFIX, "parsed", {
    url: url.slice(0, 120),
    lapCount: laps.length,
    driverName,
    className,
    starredCount: lines.filter((l) => l.liveRcPracticeStarred).length,
    sessionCompletedAtIso,
  });

  return {
    parserId: LIVERC_PRACTICE_PARSER_ID,
    laps,
    lapRows,
    sessionCompletedAtIso,
    candidates: [
      {
        id: "liverc_practice_primary",
        label: `${driverName} · ${laps.length} laps (practice)`,
        laps,
        roleHint: "primary",
      },
    ],
    sessionDrivers: [sessionDriver],
    sessionHint: { name: null, className },
    message: `Imported ${laps.length} practice laps from LiveRC (all laps included; * markers are informational only).`,
  };
}

export async function importLiveRcPracticeSession(pageUrl: string): Promise<LapUrlParseResult> {
  const trimmed = pageUrl.trim();
  if (!isLiveRcPracticeSessionUrl(trimmed)) {
    return {
      parserId: LIVERC_PRACTICE_PARSER_ID,
      laps: [],
      candidates: [],
      message: "Unsupported LiveRC practice URL format",
      errorCode: "unsupported_url",
      sessionHint: { name: null, className: null },
    };
  }

  const fetched = await fetchUrlText(trimmed);
  if (!fetched.ok) {
    return {
      parserId: LIVERC_PRACTICE_PARSER_ID,
      laps: [],
      candidates: [],
      message: fetched.error,
      errorCode: "fetch_failed",
      sessionHint: { name: null, className: null },
    };
  }

  return parseLiveRcPracticeSession(fetched.text, trimmed);
}
