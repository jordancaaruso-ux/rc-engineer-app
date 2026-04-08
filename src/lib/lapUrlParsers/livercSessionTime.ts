/**
 * LiveRC exposes human-readable session/run timing in the practice view_session `<title>`
 * (text after "Practice Session for … on …") and often in race result `<title>` / body.
 * We parse to UTC ISO for storage; unparseable strings yield null (caller uses import time).
 */

import { load } from "cheerio";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Source: practice page `<title>`, e.g.
 * `Practice Session for Driver Name on Wednesday, 8 April 2025 at 2:30 PM :: Track :: LiveRC`
 * The segment after ` on ` (before ` :: ` or ` - LiveRC`) is the session wall-clock on track.
 */
export function extractLiveRcPracticeSessionWhenRaw(title: string): string | null {
  const t = normalizeWhitespace(title);
  const m = t.match(/\bPractice\s+Session\s+for\s+.+?\s+on\s+(.+)/i);
  if (!m?.[1]) return null;
  let rest = m[1].trim();
  rest = rest.replace(/\s*::.*$/i, "").trim();
  rest = rest.replace(/\s*-\s*LiveRC.*$/i, "").trim();
  return rest.length >= 6 ? rest : null;
}

/**
 * Race result page: try `<title>` segment after ` on `, else first weekday+date+time line in body text.
 */
export function extractLiveRcRaceSessionWhenRaw(html: string): string | null {
  const $ = load(html);
  const title = normalizeWhitespace($("title").text());
  const onTitle = title.match(/\bon\s+(.+)/i);
  if (onTitle?.[1]) {
    let rest = onTitle[1].trim().replace(/\s*::.*$/i, "").trim();
    rest = rest.replace(/\s*-\s*LiveRC.*$/i, "").trim();
    if (rest.length >= 6) return rest;
  }
  const body = normalizeWhitespace($("body").text()).slice(0, 16000);
  const dateRe =
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i;
  const dm = body.match(dateRe);
  if (dm?.[0]) return dm[0].trim();
  return null;
}

/**
 * Parse LiveRC display string to UTC ISO. Uses `Date.parse` (typical English LiveRC strings).
 */
export function parseLiveRcSessionDisplayTimeToUtcIso(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return null;
}
