import { timingUserAgent } from "@/lib/http/timingUserAgent";

import { isDemoTimingSiteEnabled, serveDemoTimingPage } from "./demoTimingSite";

export type FetchTextResult =
  | { ok: true; text: string; contentType: string; finalUrl: string }
  | { ok: false; error: string; status?: number };

/**
 * Ceiling on a fetched timing page. Raised from 1.5 MB on 2026-08-21 after it started refusing
 * MyRCM outright: their post-18.08 report pages measure ~1.51 MB, so the cap was rejecting every
 * one of them by less than a percent, and the live canary failed with "Page too large to import"
 * rather than anything that pointed at the real cause. 4 MB keeps the guard meaningful (it exists
 * so a mis-typed URL pointing at a video or an archive can't be pulled into memory) while leaving
 * MyRCM room to grow. A 4 MB string is not a memory concern in the serverless runtime; the 18 s
 * timeout below is the binding limit on anything genuinely huge.
 */
const MAX_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 18_000;

/*
 * Politeness toward the timing sites (2026-09-24 launch audit).
 *
 * Every read leaves from the same few Vercel addresses in Sydney, so if LiveRC decides we are
 * too many and blocks them, lap import stops for every driver at once. Before this, nothing here
 * held back: a 429 was just an error, and a crawl went on firing its remaining pages into it; and
 * ten drivers at one meeting each fetched the same forty race pages for themselves.
 *
 * - A site that says "slow down" (429/503, or a bot-check page) is left alone for a few minutes
 *   by this server, and every read meant for it in that window fails fast instead.
 * - Pages are shared in memory for a short time, and a page already being fetched is waited on
 *   rather than fetched twice. Per server instance, deliberately: nothing to store, nothing to go
 *   stale across a deploy. A store shared across servers is the follow-up if volume needs it.
 */
const HOST_PAUSE_DEFAULT_MS = 120_000;
const HOST_PAUSE_MIN_MS = 60_000;
const HOST_PAUSE_MAX_MS = 600_000;
const hostPausedUntil = new Map<string, number>();

const PAGE_CACHE_MAX_BYTES = 48_000_000;
const PAGE_CACHE_MAX_ENTRY_BYTES = 1_500_000;
type OkResult = Extract<FetchTextResult, { ok: true }>;
const pageCache = new Map<string, { result: OkResult; expiresAt: number; bytes: number }>();
let pageCacheBytes = 0;
const inFlight = new Map<string, Promise<FetchTextResult>>();

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * How long a page may be shared. A posted race result and the lap pages hanging off it do not
 * change; lists and meeting pages move as sessions finish, so a driver waits at most this long
 * to see one that has just posted.
 */
export function sharedPageSeconds(url: string): number {
  if (/[?&]p=(view_race_result|view_race_laps|view_driver_laps|view_laps|driver_laps)(&|$)/i.test(url)) {
    return 3600;
  }
  if (/[?&]p=view_session(&|$)/i.test(url)) return 600;
  return 30;
}

/** A bot-check page served in place of the real one (Cloudflare and friends). */
export function looksLikeBotCheck(text: string): boolean {
  const head = text.slice(0, 6000);
  return (
    /<title>\s*(Just a moment|Attention Required|Access denied)/i.test(head) ||
    /cf-browser-verification|challenge-platform|cf_chl_opt/i.test(head)
  );
}

function pauseHost(host: string, retryAfterHeader: string | null): void {
  if (!host) return;
  const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const ms = Number.isFinite(seconds)
    ? Math.min(HOST_PAUSE_MAX_MS, Math.max(HOST_PAUSE_MIN_MS, seconds * 1000))
    : HOST_PAUSE_DEFAULT_MS;
  hostPausedUntil.set(host, Date.now() + ms);
}

function readCachedPage(url: string): OkResult | null {
  const hit = pageCache.get(url);
  if (!hit) return null;
  pageCache.delete(url);
  if (hit.expiresAt <= Date.now()) {
    pageCacheBytes -= hit.bytes;
    return null;
  }
  pageCache.set(url, hit); // most recently used goes to the back
  return hit.result;
}

function storeCachedPage(url: string, result: OkResult): void {
  const bytes = result.text.length;
  if (bytes > PAGE_CACHE_MAX_ENTRY_BYTES) return;
  const old = pageCache.get(url);
  if (old) {
    pageCache.delete(url);
    pageCacheBytes -= old.bytes;
  }
  pageCache.set(url, { result, expiresAt: Date.now() + sharedPageSeconds(url) * 1000, bytes });
  pageCacheBytes += bytes;
  for (const [key, entry] of pageCache) {
    if (pageCacheBytes <= PAGE_CACHE_MAX_BYTES) break;
    pageCache.delete(key);
    pageCacheBytes -= entry.bytes;
  }
}

export async function fetchUrlText(
  url: string,
  options?: { timeoutMs?: number }
): Promise<FetchTextResult> {
  // Product-video demo track (dev only, env-gated): every timing parser and every discovery
  // crawl reads pages through here, so answering from memory replaces the whole timing site
  // for one invented host and leaves every real one untouched. See demoTimingSite.ts.
  if (isDemoTimingSiteEnabled()) {
    const demo = serveDemoTimingPage(url);
    if (demo) return demo;
  }

  const host = hostOf(url);
  const pausedUntil = hostPausedUntil.get(host) ?? 0;
  if (pausedUntil > Date.now()) {
    return {
      ok: false,
      error: "The timing site asked us to slow down. Try again in a few minutes.",
      status: 429,
    };
  }

  const cached = readCachedPage(url);
  if (cached) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = fetchUncached(url, host, options?.timeoutMs);
  inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}

async function fetchUncached(
  url: string,
  host: string,
  timeoutMsOption: number | undefined
): Promise<FetchTextResult> {
  const controller = new AbortController();
  const timeoutMs =
    typeof timeoutMsOption === "number" && timeoutMsOption > 0 ? timeoutMsOption : DEFAULT_TIMEOUT_MS;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": timingUserAgent(),
        Accept: "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
      },
    });
    if (!res.ok) {
      if (res.status === 429 || res.status === 503) {
        pauseHost(host, res.headers.get("retry-after"));
      } else if (res.status === 403) {
        const body = await res.text().catch(() => "");
        if (looksLikeBotCheck(body)) pauseHost(host, null);
      }
      return { ok: false, error: `HTTP ${res.status} from server`, status: res.status };
    }
    const ct = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: "Page too large to import (max ~4 MB).", status: res.status };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    // A bot check served as a 200 used to parse as "nothing posted at this track yet".
    if (looksLikeBotCheck(text)) {
      pauseHost(host, null);
      return {
        ok: false,
        error: "The timing site is refusing automated reads right now. Try again later.",
        status: 403,
      };
    }
    const result: OkResult = { ok: true, text, contentType: ct, finalUrl: res.url };
    storeCachedPage(url, result);
    return result;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Request timed out." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  } finally {
    clearTimeout(t);
  }
}
