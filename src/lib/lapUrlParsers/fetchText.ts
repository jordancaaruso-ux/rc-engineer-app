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

  const controller = new AbortController();
  const timeoutMs =
    typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
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
      return { ok: false, error: `HTTP ${res.status} from server`, status: res.status };
    }
    const ct = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: "Page too large to import (max ~4 MB).", status: res.status };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { ok: true, text, contentType: ct, finalUrl: res.url };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Request timed out." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  } finally {
    clearTimeout(t);
  }
}
