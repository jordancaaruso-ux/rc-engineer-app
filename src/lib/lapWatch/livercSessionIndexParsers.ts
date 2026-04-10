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

function looksLikePracticeListUrl(urlStr: string): boolean {
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

function looksLikeResultsIndexUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!/\.liverc\.com$/i.test(u.hostname)) return false;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    return path.endsWith("/results") && !u.searchParams.get("id");
  } catch {
    return false;
  }
}

export type ExtractedPracticeSession = {
  driverName: string;
  sessionTime: string | null;
  sessionCompletedAtIso: string | null;
  sessionId: string;
  sessionUrl: string;
};

export type ExtractedRaceSession = {
  driverName: string | null;
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
  if (!looksLikePracticeListUrl(pageUrl)) return [];
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

    // Heuristic extraction for a display time token inside the row.
    // We keep this conservative: if no match, store null and watcher will rely on forceImport mode.
    const timeCandidate =
      rowText.match(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i
      )?.[0] ??
      rowText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i)?.[0] ??
      null;

    const sessionTime = timeCandidate ? normalizeWhitespace(timeCandidate) : null;
    const sessionCompletedAtIso = sessionTime ? parseLiveRcSessionDisplayTimeToUtcIso(sessionTime) : null;

    out.push({ driverName, sessionTime, sessionCompletedAtIso, sessionId, sessionUrl });
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
 * LiveRC results index page:
 * `.../results/` (no `id=` in query)
 *
 * Deterministic mapping:
 * - **sessionUrl**: any `<a href>` containing `p=view_race_result&id=...`
 * - **sessionId**: `id` query param from that link
 * - **raceClass**: best-effort from the row text (commonly a column named "Class")
 * - **sessionTime**: best-effort date/time substring from the row text
 *
 * Notes:
 * - Driver names are not reliably per-session on the index page; the detailed result page has drivers.
 *   We return `driverName: null` and the watcher can pass the watched-source driver name into the importer.
 */
export function extractRaceSessions(html: string, pageUrl: string): ExtractedRaceSession[] {
  if (!looksLikeResultsIndexUrl(pageUrl)) return [];
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
    const rowText = normalizeWhitespace(tr.length ? tr.text() : $(a).parent().text());

    const timeCandidate =
      rowText.match(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i
      )?.[0] ??
      rowText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i)?.[0] ??
      null;
    const sessionTime = timeCandidate ? normalizeWhitespace(timeCandidate) : null;
    const sessionCompletedAtIso = sessionTime ? parseLiveRcSessionDisplayTimeToUtcIso(sessionTime) : null;

    // "Class" column text is inconsistent; try a conservative capture.
    const raceClass =
      rowText.match(/\bClass\b\s*[:\-]\s*([A-Za-z0-9 _./+-]{2,40})/i)?.[1]?.trim() ??
      null;

    out.push({ driverName: null, raceClass, sessionTime, sessionCompletedAtIso, sessionId, sessionUrl });
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

