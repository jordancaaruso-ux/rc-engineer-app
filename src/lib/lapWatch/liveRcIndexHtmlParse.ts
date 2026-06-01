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

export function buildPracticeSessionListUrl(origin: string, dateYmd: string): string {
  const u = new URL("/practice/", origin);
  u.searchParams.set("p", "session_list");
  u.searchParams.set("d", dateYmd);
  return u.toString();
}
