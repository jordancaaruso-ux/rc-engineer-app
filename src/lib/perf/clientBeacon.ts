/**
 * Buffers client metrics and ships them with `sendBeacon`.
 *
 * Module-scope state on purpose: web-vitals reports arrive from listeners that outlive
 * any component, and a per-component buffer would drop metrics on unmount.
 */
import type { ClientMetric } from "@/lib/perf/beaconPayload";
import { MAX_METRICS_PER_BEACON } from "@/lib/perf/beaconPayload";

const BEACON_URL = "/api/perf/beacon";
/** Flush once the buffer reaches this; a page load produces 5-6 vitals. */
const FLUSH_AT = 8;
/** Bound the dedupe set on a long session rather than leaking for hours. */
const MAX_SEEN = 500;

const buffer: ClientMetric[] = [];
const seen = new Set<string>();
let listenersAttached = false;

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

/**
 * Only the client can tell these apart — the Capacitor webview's user agent is
 * indistinguishable from mobile Safari, so this cannot be derived server-side.
 */
function detectPlatform(): string {
  try {
    if (window.Capacitor?.isNativePlatform?.()) return "ios-native";
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    return standalone ? "pwa" : "web";
  } catch {
    return "web";
  }
}

function flush(): void {
  if (buffer.length === 0) return;
  const metrics = buffer.splice(0, buffer.length);
  const body = JSON.stringify({ metrics: metrics.slice(0, MAX_METRICS_PER_BEACON) });

  try {
    if (navigator.sendBeacon?.(BEACON_URL, new Blob([body], { type: "application/json" }))) {
      return;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    void fetch(BEACON_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* a dropped sample is not worth an error */
  }
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  // `visibilitychange` and `pagehide` are the only reliable end-of-session signals in
  // WKWebView and iOS Safari; `beforeunload` frequently never fires there. Both also
  // cover the founder backgrounding the Capacitor app mid-session.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

/**
 * Queue a metric, dropping duplicates.
 *
 * The key deliberately excludes `metricId`. React StrictMode double-invokes the effect
 * that subscribes to web-vitals, and the second subscription emits its *own* metric
 * object with a *different* id for the identical measurement — so an id-based key lets
 * every vital through twice. Value plus route is what actually identifies the reading.
 *
 * Web vitals report once per page load (LCP, FCP, TTFB) or only when they worsen
 * (INP, CLS), so no genuine second sample can collide. `soft-nav` is exempt: repeating
 * the same navigation at the same speed is normal and each one is a real data point.
 */
export function queueMetric(metric: ClientMetric): void {
  if (typeof window === "undefined") return;

  if (metric.name !== "soft-nav") {
    const dedupeKey = `${metric.name}:${metric.route}:${metric.value}`;
    if (seen.has(dedupeKey)) return;
    if (seen.size > MAX_SEEN) seen.clear();
    seen.add(dedupeKey);
  }

  buffer.push({ ...metric, platform: metric.platform ?? detectPlatform() });
  attachListeners();
  if (buffer.length >= FLUSH_AT) flush();
}
