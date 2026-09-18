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

const MONTH_NAME = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*";

/**
 * A date as LiveRC writes one, in any of its layouts: `8 April 2025`, `Jul 15, 2026`,
 * `4/8/2025`, `2026-09-12`. A month NAME is required rather than any word, so that
 * "Round 3" and "Heat 1, 2026" cannot pass for a date.
 */
const DATE_LIKE_RE = new RegExp(
  [
    String.raw`\b\d{1,2}\s+${MONTH_NAME}\s+\d{4}\b`,
    String.raw`\b${MONTH_NAME}\s+\d{1,2},?\s+\d{4}\b`,
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
  ].join("|"),
  "i"
);

/**
 * A clock immediately after the date — "at 2:30 PM", "9:48am", "(Sunday) at 10:57:58am" — kept
 * when the layout prints one. Anchored, so only a clock touching the date is taken.
 */
const TIME_AFTER_DATE_RE =
  /^[\s,]*(?:\([A-Za-z]+\)\s*)?(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm]?)/;

/**
 * The date (and clock, when the layout prints one) out of any LiveRC text.
 *
 * Returns the substring only when {@link parseLiveRcSessionDisplayTimeToUtcIso} can actually
 * read it. That check is the whole point: the race extractor used to hand back everything after
 * the first " on " in the page title, so "Bendigo **On** Road Radio Control Car Club" yielded
 * "Road Radio Control Car Club" as the session's time (seen live, 2026-09-18). Nothing that
 * cannot be parsed to an instant is a time.
 */
function extractDateTimeLike(text: string): string | null {
  const t = normalizeWhitespace(text);
  const m = t.match(DATE_LIKE_RE);
  if (!m || m.index == null) return null;
  let candidate = m[0];
  const after = t.slice(m.index + m[0].length);
  const clock = after.match(TIME_AFTER_DATE_RE);
  if (clock?.[1]) candidate = `${candidate} ${clock[1]}`;
  return parseLiveRcSessionDisplayTimeToUtcIso(candidate) ? candidate : null;
}

/**
 * Race result page: when the session was run.
 *
 * Read in the order the layouts are trustworthy:
 *
 *  1. `<title>` / og:title — the only source that carries a CLOCK as well as a date
 *     ("… on Saturday, 8 April 2025 at 2:30 PM"). Most race pages have no date here at all.
 *  2. The breadcrumb's calendar line — `<h5 class="page-header"><span class="fa fa-calendar">`
 *     beside the club and meeting name. Every LiveRC race page prints it and it is the reason
 *     194 of 217 race imports on file had no on-track date and showed their IMPORT time
 *     instead (2026-09-18): the old body scan demanded a weekday in front of the date, and
 *     LiveRC writes "Jul 15, 2026".
 *  3. Anything date-shaped in the body, as a last resort.
 *
 * A multi-day meeting prints a RANGE here ("Sep 12, 2026 to Sep 13, 2026") and only its first
 * day is taken — the page does not say which day this heat ran. That is a day-level answer for
 * a heat on day two, and still nearer than the day it was imported. A session imported through
 * meeting discovery never reaches this: it carries its own per-session clock.
 */
export function extractLiveRcRaceSessionWhenRaw(html: string): string | null {
  const $ = load(html);
  const titleSources = [
    normalizeWhitespace($("title").text()),
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? ""),
    normalizeWhitespace($('meta[name="twitter:title"]').attr("content") ?? ""),
  ].filter((s) => s.length > 0);

  for (const text of titleSources) {
    const fromTitle = extractDateTimeLike(text);
    if (fromTitle) return fromTitle;
  }

  const calendarLine = $(".page-breadcrumb")
    .find(".fa-calendar")
    .first()
    .parent()
    .text();
  const fromCalendar = calendarLine ? extractDateTimeLike(calendarLine) : null;
  if (fromCalendar) return fromCalendar;

  return extractDateTimeLike(normalizeWhitespace($("body").text()).slice(0, 24000));
}

/** A zone written into the string itself ("GMT", "UTC", "Z", "+09:30") — then it is a real instant. */
const EXPLICIT_ZONE_RE = /(?:\b(?:UTC|GMT)\b|\dZ\b|[+-]\d{2}:?\d{2}\s*$)/i;

/**
 * `Date.parse` reads a zone-less string in the SERVER's zone. The stored convention is the track's
 * wall clock written as UTC — which is what a UTC server (Vercel) produces — so the server's own
 * offset is taken back out. On a dev box at UTC+9:30 or +10 every LiveRC time otherwise landed that
 * many hours early: runs showed at 1 am and a 9:48 am race slid into the previous day and was
 * never imported (SA State Titles, 2026-09-16).
 */
function parseAsWallClockUtc(v: string): string | null {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  if (EXPLICIT_ZONE_RE.test(v)) return new Date(ms).toISOString();
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString();
}

/**
 * Parse LiveRC display string to UTC ISO — the track's wall clock written as UTC, whatever zone the
 * server runs in. Uses `Date.parse` plus a few normalizations for LiveRC variants.
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

  const tryParse = parseAsWallClockUtc;

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
        const dt = new Date(Date.UTC(y, m - 1, d, h24, min, 0, 0));
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      } else {
        const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
        if (!Number.isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  }

  return null;
}

/**
 * What LiveRC calls a race, from the page `<title>`.
 *
 * LiveRC titles a race result page as
 *   `TFTR :: TFTR 2026 Championship Round 10 - Whale CCW :: ISTC Modified A3-Main :: LiveRC`
 * — track, meeting, session, brand. The last segment before the brand is the only place the
 * page states which race this is; there is no heading, no meta tag and no field in the results
 * table that carries it.
 *
 * Without this the race parser had nothing to report and filed a diagnostic marker in its
 * place, which the library then printed as the session's name. Every LiveRC race a driver had
 * ever pasted in read `racer_laps_session_loaded`.
 *
 * Three segments are required after the brand is dropped. A shorter title has no session
 * segment to take, and returning the meeting name for it would file every race at a meeting
 * under one name.
 */
export function extractLiveRcRaceSessionNameFromHtml(html: string): string | null {
  const $ = load(html);
  const sources = [
    normalizeWhitespace($("title").text()),
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? ""),
    normalizeWhitespace($('meta[name="twitter:title"]').attr("content") ?? ""),
  ].filter((s) => s.length > 0);

  for (const text of sources) {
    const parts = text
      .split("::")
      .map((s) => normalizeWhitespace(s))
      .filter((s) => s.length > 0 && !/^liverc(\.com)?$/i.test(s));
    if (parts.length < 3) continue;
    const name = parts[parts.length - 1]!;
    // A date landed here on at least one layout; a session name is not a date.
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(name)) continue;
    if (name.length < 2 || name.length > 80) continue;
    return name;
  }
  return null;
}
