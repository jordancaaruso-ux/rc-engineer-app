import "server-only";

import { load } from "cheerio";
import { fetchUrlText } from "./fetchText";
import { extractRaceSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import {
  liveRcEventsThatMayHoldDay,
  type LiveRcEventListRow,
} from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { fetchLiveRcEventList, resolveRaceEventHubUrl } from "@/lib/lapWatch/resolveLiveRcIndexUrl";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";

/**
 * When a LiveRC race ran, read off its meeting's results list.
 *
 * A race result page prints only the MEETING's date — "Sep 20, 2026", or "Sep 12, 2026 to
 * Sep 13, 2026" at a two-day meeting — never the race's own time. Read on its own it filed every
 * race at midnight on the meeting's first day: a 2:23 pm A-main read 12:00 am, a Sunday final
 * landed on the Saturday, and a day's races all sat at the same instant and folded into one run
 * (test drive, 2026-09-26). The meeting's results list prints each race's time ("Race 2: 4wd
 * Stock Buggy A-Main · Sep 20, 2026 at 1:48pm"). It is the list URL Auto already reads, which is
 * why races picked from it showed their times right up until they were imported.
 *
 * The race page does not link its meeting, so the meeting is found on the track's events page by
 * the name the breadcrumb prints (the events page lists it under the same name), then among the
 * meetings that could hold the page's date, then the one the track's front page calls current.
 */

/** Meeting pages read for one race at most. The first is nearly always the one. */
const MAX_HUB_PAGES = 4;
/** A meeting page that is slow to answer is skipped: the page's own date still stands. */
const HUB_FETCH_TIMEOUT_MS = 8_000;

export type LiveRcRaceMeeting = {
  /** The meeting's name, as the page's breadcrumb prints it. */
  name: string | null;
  /** The meeting's first and last day (YYYY-MM-DD, the track's dates) off the calendar line. */
  firstYmd: string | null;
  lastYmd: string | null;
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function meetingNameKey(s: string): string {
  return normalizeWhitespace(s.normalize("NFKC")).toLowerCase();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Every "Sep 12, 2026" in the text, as YYYY-MM-DD, in order. */
function ymdsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (!month) continue;
    out.push(`${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`);
  }
  return out;
}

/**
 * The meeting a race result page belongs to: its name and dates, off the breadcrumb every LiveRC
 * race page prints (`fa-list-ol` beside the meeting's name, `fa-calendar` beside its dates). The
 * title's middle segment stands in for the name when the breadcrumb is missing.
 */
export function extractLiveRcRaceMeeting(html: string): LiveRcRaceMeeting {
  const $ = load(html);
  const crumb = $(".page-breadcrumb");
  let name = normalizeWhitespace(crumb.find(".fa-list-ol").first().parent().text());
  if (!name) {
    // "Track :: Meeting :: Race :: LiveRC"
    const parts = normalizeWhitespace($("title").text())
      .split("::")
      .map((s) => normalizeWhitespace(s))
      .filter((s) => s.length > 0 && !/^liverc(\.com)?$/i.test(s));
    if (parts.length >= 3) name = parts.slice(1, -1).join(" :: ");
  }
  const days = ymdsIn(normalizeWhitespace(crumb.find(".fa-calendar").first().parent().text()));
  return {
    name: name || null,
    firstYmd: days[0] ?? null,
    lastYmd: days[days.length - 1] ?? null,
  };
}

/**
 * The meeting pages to look in, most likely first: the meeting of the same name on the page's
 * dates (a club reuses "Club Day" every week, so the name alone is not enough), then every
 * meeting that could hold the page's first day.
 */
export function liveRcHubsForRaceMeeting(
  events: readonly LiveRcEventListRow[],
  meeting: LiveRcRaceMeeting,
): string[] {
  const out: string[] = [];
  const add = (url: string) => {
    if (!out.includes(url)) out.push(url);
  };
  const want = meeting.name ? meetingNameKey(meeting.name) : "";
  const first = meeting.firstYmd;
  const last = meeting.lastYmd ?? first;
  if (want) {
    for (const e of events) {
      if (meetingNameKey(e.name) !== want) continue;
      if (first && last && !(e.startYmd <= last && e.endYmd >= first)) continue;
      add(e.eventHubUrl);
    }
  }
  if (first) {
    for (const e of liveRcEventsThatMayHoldDay(events, first)) add(e.eventHubUrl);
  }
  return out;
}

/**
 * This race's time as a meeting's results list prints it, in the parsers' convention (the track's
 * wall clock written as UTC). Null when the list does not carry the race, or carries it with a
 * date and no clock — that is no better than the race page's own date.
 */
export function listedTimeOfLiveRcRace(hubHtml: string, hubUrl: string, raceId: string): string | null {
  const row = extractRaceSessions(hubHtml, hubUrl).find((r) => r.sessionId === raceId);
  if (!row?.sessionCompletedAtIso || !/\d{1,2}:\d{2}/.test(row.sessionTime ?? "")) return null;
  return row.sessionCompletedAtIso;
}

function eventIdOf(hubUrl: string): string | null {
  try {
    return new URL(hubUrl).searchParams.get("id")?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Find the race on its meeting's results list and return its listed time; null when it cannot be
 * found, and the caller keeps the page's own date. Every page read here is one the lap step's scan
 * reads too, and they are shared through the page cache, so this is rarely a new request.
 */
export async function findLiveRcRaceListedTime(raceUrl: string, raceHtml: string): Promise<string | null> {
  let raceId: string | null = null;
  try {
    raceId = new URL(raceUrl.trim()).searchParams.get("id")?.trim() || null;
  } catch {
    raceId = null;
  }
  const origin = normalizeLiveRcTrackOrigin(raceUrl);
  if (!raceId || !origin) return null;

  const meeting = extractLiveRcRaceMeeting(raceHtml);
  const list = await fetchLiveRcEventList(origin);
  const hubs = list.ok ? liveRcHubsForRaceMeeting(list.events, meeting) : [];

  const tried = new Set<string>();
  const tryHub = async (hubUrl: string): Promise<string | null> => {
    const key = eventIdOf(hubUrl) ?? hubUrl;
    if (tried.has(key) || tried.size >= MAX_HUB_PAGES) return null;
    tried.add(key);
    const hub = await fetchUrlText(hubUrl, { timeoutMs: HUB_FETCH_TIMEOUT_MS });
    return hub.ok ? listedTimeOfLiveRcRace(hub.text, hubUrl, raceId!) : null;
  };

  for (const hubUrl of hubs) {
    const at = await tryHub(hubUrl);
    if (at) return at;
  }
  // A meeting running today can be missing from the events page; the front page links it.
  if (tried.size < MAX_HUB_PAGES) {
    const current = await resolveRaceEventHubUrl(origin);
    if (current.ok) return tryHub(current.indexUrl);
  }
  return null;
}
