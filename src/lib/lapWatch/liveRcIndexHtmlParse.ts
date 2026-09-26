import { load } from "cheerio";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";

function absoluteUrl(baseUrl: string, href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  try {
    return new URL(h, baseUrl).toString();
  } catch {
    return null;
  }
}

export type ParsedLiveRcDashboard = {
  origin: string;
  currentEventHubUrl: string | null;
  currentEventLabel: string | null;
  livePractice: boolean;
};

/** Parse LiveRC track dashboard HTML for current event + live practice signals. */
export function parseLiveRcDashboardHtml(html: string, pageUrl: string): ParsedLiveRcDashboard {
  const origin = normalizeLiveRcTrackOrigin(pageUrl) ?? pageUrl;
  const $ = load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const livePractice = /\bLIVE\s*\(\s*Practice\s*\)/i.test(bodyText) || /\bWatch Live Practice\b/i.test(bodyText);

  let currentEventHubUrl: string | null = null;
  let currentEventLabel: string | null = null;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const abs = absoluteUrl(pageUrl, href);
    if (!abs) return;
    try {
      const u = new URL(abs);
      const p = (u.searchParams.get("p") ?? "").toLowerCase();
      if (p === "view_event" && u.searchParams.get("id")?.trim()) {
        if (/view current event/i.test(text) || !currentEventHubUrl) {
          currentEventHubUrl = u.toString();
          currentEventLabel = text && !/view current event/i.test(text) ? text : null;
        }
      }
    } catch {
      /* skip */
    }
  });

  return { origin, currentEventHubUrl, currentEventLabel, livePractice };
}

/** Extract `session_list&d=YYYY-MM-DD` dates from practice calendar HTML. */
export function parsePracticeSessionListDatesFromHtml(html: string, pageUrl: string): string[] {
  const $ = load(html);
  const dates = new Set<string>();
  const re = /[?&]d=(\d{4}-\d{2}-\d{2})/i;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const abs = absoluteUrl(pageUrl, href);
    const target = abs ?? href;
    const m = target.match(re);
    if (m?.[1]) dates.add(m[1]);
  });

  const body = html.match(/session_list[^"']*[?&]d=(\d{4}-\d{2}-\d{2})/gi) ?? [];
  for (const chunk of body) {
    const m = chunk.match(/d=(\d{4}-\d{2}-\d{2})/i);
    if (m?.[1]) dates.add(m[1]);
  }

  return [...dates].sort((a, b) => b.localeCompare(a));
}

/** One meeting on a track's LiveRC events page (`/events/`), dated as the club entered it. */
export type LiveRcEventListRow = {
  eventHubUrl: string;
  eventId: string;
  name: string;
  /** YYYY-MM-DD, the track's date. */
  startYmd: string;
  /** Same as `startYmd` for a one-day meeting. */
  endYmd: string;
  /** The "# Entries" column: 0 for a meeting posted ahead that nobody has entered yet. */
  entries?: number | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Sep 13, 2026" → "2026-09-13"; anything else → null. */
function ymdFromLiveRcDateText(text: string): string | null {
  const m = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})\b/.exec(text);
  const month = m ? MONTHS[m[1]!.toLowerCase()] : undefined;
  if (!m || !month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * Every meeting on a track's `/events/` page. LiveRC ships the whole history in one table (the
 * paging is client-side), each row carrying a sortable hidden `2026-09-12 00:00:00` and a readable
 * "Sep 12, 2026 to Sep 13, 2026".
 */
export function parseLiveRcEventListHtml(html: string, pageUrl: string): LiveRcEventListRow[] {
  const $ = load(html);
  const out: LiveRcEventListRow[] = [];
  const seen = new Set<string>();
  $("tr").each((_, tr) => {
    const link = $(tr).find("a[href*='view_event']").first();
    const abs = absoluteUrl(pageUrl, link.attr("href") ?? "");
    if (!abs) return;
    let eventId: string | null = null;
    try {
      const u = new URL(abs);
      if ((u.searchParams.get("p") ?? "").toLowerCase() !== "view_event") return;
      eventId = u.searchParams.get("id")?.trim() || null;
    } catch {
      return;
    }
    if (!eventId || seen.has(eventId)) return;

    const cells = $(tr).find("td");
    const dateCell = cells.eq(1);
    const hidden = dateCell.find(".hidden").first().text();
    const startYmd = /\d{4}-\d{2}-\d{2}/.exec(hidden)?.[0] ?? ymdFromLiveRcDateText(dateCell.text());
    if (!startYmd) return;
    const readable = dateCell.clone().find(".hidden").remove().end().text().replace(/\s+/g, " ");
    const endText = readable.split(/\bto\b/i)[1] ?? "";
    const endYmd = ymdFromLiveRcDateText(endText);
    const entriesText = cells.eq(2).text().trim();

    seen.add(eventId);
    out.push({
      eventHubUrl: abs,
      eventId,
      name: link.text().replace(/\s+/g, " ").trim(),
      startYmd,
      endYmd: endYmd && endYmd >= startYmd ? endYmd : startYmd,
      entries: /^\d+$/.test(entriesText) ? Number(entriesText) : null,
    });
  });
  return out;
}

function ymdShift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * How far a meeting's races can sit from the date it is listed under. The dates are typed by the
 * club and are not a boundary: SA State Titles 2026 was listed as "Sep 11" and ran its qualifiers
 * on the 12th, beside a second listing "Sep 12 to Sep 13" that held nothing.
 */
const EVENT_DATE_SLACK_BEFORE_DAYS = 7;
const EVENT_DATE_SLACK_AFTER_DAYS = 1;

/**
 * The meetings whose races could fall on `ymd`: listed as spanning it, or starting within a week
 * before it (or the day after). Opening a hub that holds nothing that day costs one page; missing
 * the one that does costs the driver their runs.
 */
export function liveRcEventsThatMayHoldDay(
  events: readonly LiveRcEventListRow[],
  ymd: string,
): LiveRcEventListRow[] {
  const earliest = ymdShift(ymd, -EVENT_DATE_SLACK_BEFORE_DAYS);
  const latest = ymdShift(ymd, EVENT_DATE_SLACK_AFTER_DAYS);
  return events.filter(
    (e) => (e.startYmd >= earliest && e.startYmd <= latest) || (e.startYmd <= ymd && e.endYmd >= ymd),
  );
}

export function buildPracticeSessionListUrl(origin: string, dateYmd: string): string {
  const u = new URL("/practice/", origin);
  u.searchParams.set("p", "session_list");
  u.searchParams.set("d", dateYmd);
  return u.toString();
}
