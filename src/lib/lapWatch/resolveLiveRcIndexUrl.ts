import "server-only";

import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  isLiveRcPracticeListUrl,
  isLiveRcResultsDiscoveryUrl,
} from "@/lib/lapWatch/livercSessionIndexParsers";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import {
  parseLiveRcDashboardHtml,
  parsePracticeSessionListDatesFromHtml,
  buildPracticeSessionListUrl,
  type ParsedLiveRcDashboard,
} from "@/lib/lapWatch/liveRcIndexHtmlParse";

export {
  parseLiveRcDashboardHtml,
  parsePracticeSessionListDatesFromHtml,
  buildPracticeSessionListUrl,
  type ParsedLiveRcDashboard,
} from "@/lib/lapWatch/liveRcIndexHtmlParse";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | null {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return row.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
}

export type ResolveLiveRcIndexResult =
  | { ok: true; indexUrl: string; kind: "practice" | "results"; activityDate: string | null }
  | { ok: false; error: string };

export async function fetchLiveRcDashboard(origin: string): Promise<
  | { ok: true; html: string; pageUrl: string; parsed: ParsedLiveRcDashboard }
  | { ok: false; error: string }
> {
  const cached = cacheGet<{ ok: true; html: string; pageUrl: string; parsed: ParsedLiveRcDashboard }>(
    `dash:${origin}`
  );
  if (cached) return cached;

  const pageUrl = `${origin}/`;
  const fetched = await fetchUrlText(pageUrl);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const parsed = parseLiveRcDashboardHtml(fetched.text, fetched.finalUrl ?? pageUrl);
  const result = { ok: true as const, html: fetched.text, pageUrl: fetched.finalUrl ?? pageUrl, parsed };
  cacheSet(`dash:${origin}`, result);
  return result;
}

export async function resolveMostRecentPracticeListUrl(origin: string): Promise<ResolveLiveRcIndexResult> {
  const cacheKey = `practice:${origin}`;
  const cached = cacheGet<ResolveLiveRcIndexResult>(cacheKey);
  if (cached) return cached;

  const practicePageUrl = `${origin}/practice/`;
  const fetched = await fetchUrlText(practicePageUrl);
  if (!fetched.ok) {
    return { ok: false, error: fetched.error };
  }

  let dates = parsePracticeSessionListDatesFromHtml(fetched.text, fetched.finalUrl ?? practicePageUrl);

  if (dates.length === 0) {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const ym = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    const prevUrl = `${origin}/practice/?ym=${ym}`;
    const prevFetch = await fetchUrlText(prevUrl);
    if (prevFetch.ok) {
      dates = parsePracticeSessionListDatesFromHtml(prevFetch.text, prevFetch.finalUrl ?? prevUrl);
    }
  }

  if (dates.length === 0) {
    return { ok: false, error: "No practice days with sessions found on LiveRC." };
  }

  const latest = dates[0]!;
  const result: ResolveLiveRcIndexResult = {
    ok: true,
    indexUrl: buildPracticeSessionListUrl(origin, latest),
    kind: "practice",
    activityDate: latest,
  };
  cacheSet(cacheKey, result);
  return result;
}

export async function resolveRaceEventHubUrl(origin: string): Promise<ResolveLiveRcIndexResult> {
  const cacheKey = `race:${origin}`;
  const cached = cacheGet<ResolveLiveRcIndexResult>(cacheKey);
  if (cached) return cached;

  const dash = await fetchLiveRcDashboard(origin);
  if (!dash.ok) return dash;

  if (dash.parsed.currentEventHubUrl) {
    const result: ResolveLiveRcIndexResult = {
      ok: true,
      indexUrl: dash.parsed.currentEventHubUrl,
      kind: "results",
      activityDate: null,
    };
    cacheSet(cacheKey, result);
    return result;
  }

  const resultsUrl = `${origin}/results/`;
  const fetched = await fetchUrlText(resultsUrl);
  if (!fetched.ok) {
    return { ok: false, error: "No current event on LiveRC dashboard and results page could not be loaded." };
  }

  const result: ResolveLiveRcIndexResult = {
    ok: true,
    indexUrl: fetched.finalUrl ?? resultsUrl,
    kind: "results",
    activityDate: null,
  };
  cacheSet(cacheKey, result);
  return result;
}

export function isLiveRcResolvableUrl(urlStr: string): boolean {
  if (isLiveRcPracticeListUrl(urlStr) || isLiveRcResultsDiscoveryUrl(urlStr)) return false;
  return normalizeLiveRcTrackOrigin(urlStr) != null;
}

export async function resolveLiveRcIndexUrl(input: {
  url: string;
  kind: "practice" | "results";
}): Promise<ResolveLiveRcIndexResult> {
  const trimmed = input.url.trim();
  if (input.kind === "practice" && isLiveRcPracticeListUrl(trimmed)) {
    const d = new URL(trimmed).searchParams.get("d");
    return { ok: true, indexUrl: trimmed, kind: "practice", activityDate: d };
  }
  if (input.kind === "results" && isLiveRcResultsDiscoveryUrl(trimmed)) {
    return { ok: true, indexUrl: trimmed, kind: "results", activityDate: null };
  }

  const origin = normalizeLiveRcTrackOrigin(trimmed);
  if (!origin) {
    return { ok: false, error: "Not a recognizable LiveRC track URL." };
  }

  return input.kind === "practice"
    ? resolveMostRecentPracticeListUrl(origin)
    : resolveRaceEventHubUrl(origin);
}

/** @internal test hook */
export function clearLiveRcIndexResolverCacheForTests(): void {
  cache.clear();
}
