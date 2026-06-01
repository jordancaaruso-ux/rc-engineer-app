import { validateTimingHttpUrlSync } from "@/lib/http/timingUrlSafety";

/** Normalize a LiveRC URL to track origin: `https://{slug}.liverc.com` */
export function normalizeLiveRcTrackOrigin(urlStr: string): string | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  const v = validateTimingHttpUrlSync(trimmed);
  if (!v.ok) return null;
  try {
    const u = new URL(v.normalized);
    if (!/\.liverc\.com$/i.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function validateLiveRcTrackUrl(
  url: string
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "LiveRC URL is required." };
  }
  const v = validateTimingHttpUrlSync(trimmed);
  if (!v.ok) return v;
  const origin = normalizeLiveRcTrackOrigin(v.normalized);
  if (!origin) {
    return { ok: false, error: "URL must be a *.liverc.com track site." };
  }
  return { ok: true, normalized: origin };
}
