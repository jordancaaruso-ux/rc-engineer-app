/**
 * LiveRC exposes human-readable session/run timing in the practice view_session `<title>`
 * (text after "Practice Session for … on …") and often in race result `<title>` / body.
 * We parse to UTC ISO for storage; unparseable strings yield null (caller uses import time).
 *
 * Many pages put the readable title in `og:title` while `<title>` is empty or generic — we try both.
 */

import { load } from "cheerio";

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripTrailingTitleNoise(rest: string): string {
  let r = rest.trim();
  r = r.replace(/\s*::.*$/i, "").trim();
  r = r.replace(/\s*-\s*LiveRC.*$/i, "").trim();
  return r;
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
  const rest = stripTrailingTitleNoise(m[1]);
  return rest.length >= 6 ? rest : null;
}

/**
 * Looser practice pattern when LiveRC tweaks wording/spacing (still requires "Practice Session for" and " on ").
 */
function extractLiveRcPracticeSessionWhenLoose(text: string): string | null {
  const t = normalizeWhitespace(text);
  const m = t.match(
    /\bPractice\s+Session\s+for\s+[\s\S]+?\s+on\s+(.+?)(?:\s*::|\s*-\s*LiveRC\b|$)/i
  );
  if (!m?.[1]) return null;
  const rest = stripTrailingTitleNoise(m[1]);
  return rest.length >= 6 ? rest : null;
}

/**
 * Practice: try `<title>`, then og/twitter title meta (often populated when `<title>` is empty).
 */
export function extractLiveRcPracticeSessionWhenFromHtml(html: string): string | null {
  const $ = load(html);
  const sources = [
    normalizeWhitespace($("title").text()),
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? ""),
    normalizeWhitespace($('meta[name="twitter:title"]').attr("content") ?? ""),
  ].filter((s) => s.length > 0);

  for (const text of sources) {
    let raw = extractLiveRcPracticeSessionWhenRaw(text);
    if (raw) return raw;
    raw = extractLiveRcPracticeSessionWhenLoose(text);
    if (raw) return raw;
  }
  return null;
}

function extractRaceWhenFromTitleLike(text: string): string | null {
  const t = normalizeWhitespace(text);
  const onTitle = t.match(/\bon\s+(.+)/i);
  if (!onTitle?.[1]) return null;
  const rest = stripTrailingTitleNoise(onTitle[1]);
  return rest.length >= 6 ? rest : null;
}

/**
 * Race result page: try `<title>` / og:title segment after ` on `, else date-like lines in body text.
 */
export function extractLiveRcRaceSessionWhenRaw(html: string): string | null {
  const $ = load(html);
  const titleSources = [
    normalizeWhitespace($("title").text()),
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? ""),
    normalizeWhitespace($('meta[name="twitter:title"]').attr("content") ?? ""),
  ].filter((s) => s.length > 0);

  for (const text of titleSources) {
    const fromTitle = extractRaceWhenFromTitleLike(text);
    if (fromTitle) return fromTitle;
  }

  const body = normalizeWhitespace($("body").text()).slice(0, 24000);
  const datePatterns: RegExp[] = [
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i,
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i,
    /\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/i,
  ];
  for (const dateRe of datePatterns) {
    const dm = body.match(dateRe);
    if (dm?.[0]) return dm[0].trim();
  }
  return null;
}

/**
 * Parse LiveRC display string to UTC ISO. Uses `Date.parse` plus a few normalizations for LiveRC variants.
 */
export function parseLiveRcSessionDisplayTimeToUtcIso(raw: string): string | null {
  let s = normalizeWhitespace(raw).replace(/[\u2013\u2014\u2212]/g, "-");
  if (!s) return null;

  // LiveRC lists use "Jan 25, 2026 at 3:22pm"; Node Date.parse needs "Jan 25, 2026 3:22 PM" (space + uppercase AM/PM).
  s = s.replace(/\s+at\s+/i, " ");
  s = s.replace(/\b(\d{1,2}:\d{2})(?::(\d{2}))?\s*([ap]m)\b/gi, (_, h, sec, ap) => {
    const mid = sec != null ? `:${sec}` : "";
    const suf = String(ap).toLowerCase() === "am" ? "AM" : "PM";
    return `${h}${mid} ${suf}`;
  });

  const tryParse = (v: string): string | null => {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    return null;
  };

  let out = tryParse(s);
  if (out) return out;

  out = tryParse(s.replace(/\s+at\s+/i, " "));
  if (out) return out;

  // US-style "4/8/2025 2:30 PM" (substring — raw may include trailing noise)
  const us = s.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i
  );
  if (us) {
    const [, mo, da, yr, hh, mm, _ss, ap] = us;
    const y = Number(yr);
    const m = Number(mo);
    const d = Number(da);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      if (hh != null && mm != null) {
        let h24 = Number(hh);
        const min = Number(mm);
        if (ap?.toUpperCase() === "PM" && h24 < 12) h24 += 12;
        if (ap?.toUpperCase() === "AM" && h24 === 12) h24 = 0;
        const dt = new Date(y, m - 1, d, h24, min, 0, 0);
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      } else {
        const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  }

  return null;
}
