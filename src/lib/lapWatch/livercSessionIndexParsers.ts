import "server-only";

import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";
import { parseLiveRcSessionDisplayTimeToUtcIso } from "@/lib/lapUrlParsers/livercSessionTime";
import { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

export { normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function looksLikePersonNameCell(text: string): boolean {
  const t = normalizeWhitespace(text);
  if (t.length < 3) return false;
  // Skip times, dates, pure numbers
  if (/^\d+\s*:\s*\d+/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}/.test(t)) return false;
  if (/^\d+(?:\.\d+)?$/.test(t)) return false;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return /^[A-Za-z]/.test(parts[0]!);
}

/**
 * Practice session list rows often put the session link on "View" or a time — not on the driver name.
 * Prefer a name-like table cell over raw link text when extracting the driver for this row.
 */
function guessDriverNameFromPracticeRow($: CheerioAPI, tr: unknown, linkText: string): string {
  const row = $(tr as never);
  const cells = row
    .find("td")
    .toArray()
    .map((td) => normalizeWhitespace($(td).text()))
    .filter((t) => t.length > 0);
  const fromCell = cells.find(looksLikePersonNameCell);
  if (fromCell) return fromCell;
  if (looksLikePersonNameCell(linkText)) return linkText;
  return linkText || cells[0] || "Practice session";
}

function absoluteUrl(baseUrl: string, href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  try {
    return new URL(h, baseUrl).toString();
  } catch {
    return null;
  }
}

function readSessionIdFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const id = u.searchParams.get("id");
    return id?.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

const RE_WEEKDAY_DATE =
  /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
const RE_SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i;
/** e.g. Jan 25, 2026 at 3:22pm (LiveRC race result list "Time Completed" column) */
const RE_MONTH_NAME_DATE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:[ap]m))?/i;
/** e.g. 2026-01-25 17:34:51 before duplicate am/pm noise on practice lists */
const RE_ISO_LOCAL_DATETIME = /\b\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?/;

/**
 * Best-effort datetime substring from LiveRC practice session list or race results list row text.
 */
/**
 * LiveRC result list links often look like:
 * `Race 14: ISTC 13.5T (ISTC 13.5T A3-Main)` — class lives in the anchor, not a `Class:` table cell.
 */
export function extractRaceClassFromLiveRcResultListLink(linkText: string): string | null {
  const t = normalizeWhitespace(linkText);
  if (!t) return null;
  const raceMain = t.match(/\bRace\s+\d+\s*:\s*(.+?)(?:\s*\(|$)/i);
  if (raceMain?.[1]) {
    const s = normalizeWhitespace(raceMain[1]);
    return s.length >= 2 ? s : null;
  }
  const qual = t.match(/\bQualifier\s+[^:]+:\s*(.+?)(?:\s*\(|$)/i);
  if (qual?.[1]) {
    const s = normalizeWhitespace(qual[1]);
    return s.length >= 2 ? s : null;
  }
  return null;
}

/** Row matches configured event/watch class: exact normalized match, or configured class appears in row/link text. */
export function raceListRowMatchesEventClass(
  r: Pick<ExtractedRaceSession, "raceClass" | "listLinkText">,
  configuredNorm: string
): boolean {
  if (!configuredNorm) return false;
  const col = normalizeLiveRcDriverNameForMatch(r.raceClass ?? "");
  if (col && col === configuredNorm) return true;
  const hay = normalizeLiveRcDriverNameForMatch(`${r.raceClass ?? ""} ${r.listLinkText ?? ""}`);
  if (hay && hay === configuredNorm) return true;
  if (configuredNorm.length >= 5 && hay.includes(configuredNorm)) return true;
  return false;
}

/** Multiple entries in one field: comma- or semicolon-separated class labels (same as Event race class UI). */
export function raceListRowMatchesAnyConfiguredClass(
  r: Pick<ExtractedRaceSession, "raceClass" | "listLinkText">,
  configuredRaceClassField: string
): boolean {
  const parts = configuredRaceClassField
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  for (const p of parts) {
    const n = normalizeLiveRcDriverNameForMatch(p);
    if (!n) continue;
    if (raceListRowMatchesEventClass(r, n)) return true;
  }
  return false;
}

export function extractLiveRcRowTimeCandidate(rowText: string): string | null {
  const t = normalizeWhitespace(rowText);
  if (!t) return null;
  const m1 = t.match(RE_WEEKDAY_DATE);
  if (m1?.[0]) return normalizeWhitespace(m1[0]);
  const m2 = t.match(RE_SLASH_DATE);
  if (m2?.[0]) return normalizeWhitespace(m2[0]);
  const m3 = t.match(RE_MONTH_NAME_DATE);
  if (m3?.[0]) return normalizeWhitespace(m3[0]);
  const m4 = t.match(RE_ISO_LOCAL_DATETIME);
  if (m4?.[0]) return normalizeWhitespace(m4[0]);
  return null;
}

export function isLiveRcPracticeListUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path.endsWith("/practice")) return false;
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    return p === "session_list";
  } catch {
    return false;
  }
}

/**
 * LiveRC pages where race result session links (`p=view_race_result`) can be discovered.
 * Includes bare track results hubs and event hubs such as `p=view_event&id=…` (path still `/results/`).
 */
export function isLiveRcResultsDiscoveryUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    return path.endsWith("/results");
  } catch {
    return false;
  }
}

/** LiveRC event results hub: lists links to `p=view_race_result` sessions. */
export function isLiveRcEventHubUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path.endsWith("/results")) return false;
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    const id = u.searchParams.get("id");
    return p === "view_event" && Boolean(id?.trim());
  } catch {
    return false;
  }
}

export type ExtractedPracticeSession = {
  driverName: string;
  /** Visible `<a>` text on the practice list (usually the driver name). */
  listLinkText: string | null;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  sessionId: string;
  sessionUrl: string;
};

export type ExtractedRaceSession = {
  driverName: string | null;
  /** Visible `<a>` text on the results list (e.g. "Race 15: ISTC Modified (A3-Main)"). */
  listLinkText: string | null;
  raceClass: string | null;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  sessionId: string;
  sessionUrl: string;
};

/**
 * LiveRC practice list page:
 * `.../practice/?p=session_list&d=YYYY-MM-DD`
 *
 * Deterministic mapping:
 * - **sessionUrl**: any `<a href>` containing `p=view_session&id=...`
 * - **sessionId**: `id` query param from that link
 * - **driverName**: link text (fallback: first non-empty cell text in row)
 * - **sessionTime**: best-effort date/time substring from the row's visible text
 */
export function extractPracticeSessions(html: string, pageUrl: string): ExtractedPracticeSession[] {
  if (!isLiveRcPracticeListUrl(pageUrl)) return [];
  const $ = load(html);
  const out: ExtractedPracticeSession[] = [];

  const anchors = $("a[href*='p=view_session'][href*='id=']").toArray().slice(0, 300);
  for (const a of anchors) {
    const href = $(a).attr("href") ?? "";
    const sessionUrl = absoluteUrl(pageUrl, href);
    if (!sessionUrl) continue;
    const sessionId = readSessionIdFromUrl(sessionUrl);
    if (!sessionId) continue;

    const tr = $(a).closest("tr");
    const linkText = normalizeWhitespace($(a).text());
    const rowText = normalizeWhitespace(tr.length ? tr.text() : $(a).parent().text());

    const driverName = tr.length ? guessDriverNameFromPracticeRow($, tr.get(0), linkText) : linkText || "Practice session";

    const timeCandidate = extractLiveRcRowTimeCandidate(rowText);

    const sessionTime = timeCandidate ? normalizeWhitespace(timeCandidate) : null;
    const sessionCompletedAtIso = sessionTime ? parseLiveRcSessionDisplayTimeToUtcIso(sessionTime) : null;

    const listLinkText = linkText.trim() ? linkText : null;

    out.push({
      driverName,
      listLinkText,
      sessionTime,
      sessionCompletedAtIso,
      sessionId,
      sessionUrl,
    });
  }

  // Deduplicate by sessionId (same list can contain duplicate links in header/footer).
  const seen = new Set<string>();
  const deduped: ExtractedPracticeSession[] = [];
  for (const s of out) {
    if (seen.has(s.sessionId)) continue;
    seen.add(s.sessionId);
    deduped.push(s);
  }
  return deduped;
}

/**
 * When `targetName` is set, keep only rows whose extracted driver name matches exactly (normalized).
 * When `targetName` is empty/null, return all sessions (caller may still apply time-based limits).
 *
 * Lap-watch does **not** use this for gating imports: it imports all list rows and matches on canonical
 * `displayDriverName` after parse, so list-row heuristics cannot hide real sessions.
 */
export function filterPracticeSessionsByTargetDriver(
  sessions: ExtractedPracticeSession[],
  targetName: string | null | undefined
): ExtractedPracticeSession[] {
  const raw = typeof targetName === "string" ? targetName.trim() : "";
  if (!raw) return sessions;
  const want = normalizeLiveRcDriverNameForMatch(raw);
  if (!want) return sessions;
  return sessions.filter((s) => normalizeLiveRcDriverNameForMatch(s.driverName) === want);
}

/**
 * Parse race result session links from a LiveRC results area HTML (track index or event hub).
 *
 * Deterministic mapping:
 * - **sessionUrl**: any `<a href>` containing `p=view_race_result&id=...`
 * - **sessionId**: `id` query param from that link
 * - **raceClass**: best-effort from the row text (commonly a column named "Class")
 * - **sessionTime**: best-effort date/time substring from the row text
 *
 * Notes:
 * - Driver names are not reliably per-session on the list page; the detailed result page has drivers.
 *   We return `driverName: null` and the watcher can pass the watched-source driver name into the importer.
 */
export function extractRaceSessions(html: string, pageUrl: string): ExtractedRaceSession[] {
  if (!isLiveRcResultsDiscoveryUrl(pageUrl)) return [];
  const $ = load(html);
  const out: ExtractedRaceSession[] = [];

  const anchors = $("a[href*='p=view_race_result'][href*='id=']").toArray().slice(0, 400);
  for (const a of anchors) {
    const href = $(a).attr("href") ?? "";
    const sessionUrl = absoluteUrl(pageUrl, href);
    if (!sessionUrl) continue;
    const sessionId = readSessionIdFromUrl(sessionUrl);
    if (!sessionId) continue;

    const tr = $(a).closest("tr");
    const linkText = normalizeWhitespace($(a).text());
    const rowText = normalizeWhitespace(tr.length ? tr.text() : $(a).parent().text());

    const timeCandidate = extractLiveRcRowTimeCandidate(rowText);
    const sessionTime = timeCandidate ? normalizeWhitespace(timeCandidate) : null;
    const sessionCompletedAtIso = sessionTime ? parseLiveRcSessionDisplayTimeToUtcIso(sessionTime) : null;

    // Prefer `Class:` cell; else parse class from list link text (LiveRC event hub rows).
    const raceClass =
      rowText.match(/\bClass\b\s*[:\-]\s*([A-Za-z0-9 _./+-]{2,40})/i)?.[1]?.trim() ??
      extractRaceClassFromLiveRcResultListLink(linkText) ??
      null;

    const listLinkText = linkText.trim() ? linkText : null;

    out.push({
      driverName: null,
      listLinkText,
      raceClass,
      sessionTime,
      sessionCompletedAtIso,
      sessionId,
      sessionUrl,
    });
  }

  const seen = new Set<string>();
  const deduped: ExtractedRaceSession[] = [];
  for (const s of out) {
    if (seen.has(s.sessionId)) continue;
    seen.add(s.sessionId);
    deduped.push(s);
  }
  return deduped;
}

