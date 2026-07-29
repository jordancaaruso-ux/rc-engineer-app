/**
 * Shape and validation for the client RUM beacon. Pure and dependency-free so both
 * the browser reporter and the route handler can use it, and so it is unit-testable.
 */
import { normalizeRoutePath } from "@/lib/perf/routeKey";

/** Metric names we store. Anything else is a client bug or a tampered payload. */
export const CLIENT_METRIC_NAMES = [
  "LCP",
  "INP",
  "TTFB",
  "CLS",
  "FCP",
  "FID",
  "soft-nav",
] as const;

export type ClientMetricName = (typeof CLIENT_METRIC_NAMES)[number];

export type ClientMetric = {
  name: string;
  route: string;
  value: number;
  rating?: string | null;
  navigationType?: string | null;
  fromRoute?: string | null;
  platform?: string | null;
  metricId?: string | null;
};

export type ClientMetricRow = {
  name: string;
  route: string;
  value: number;
  rating: string | null;
  navigationType: string | null;
  fromRoute: string | null;
  platform: string | null;
  metricId: string | null;
  userId: string;
  deployId: string | null;
};

/** One beacon carries at most this many metrics; the rest are dropped, not queued. */
export const MAX_METRICS_PER_BEACON = 20;
/** Values above this are meaningless (a backgrounded tab reports absurd LCP). 5 minutes. */
const MAX_METRIC_VALUE_MS = 300_000;
const MAX_SHORT_TEXT = 40;

const METRIC_NAMES = new Set<string>(CLIENT_METRIC_NAMES);

function shortText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_SHORT_TEXT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse and clamp a beacon body into rows ready for `createMany`. Returns `[]` for
 * anything malformed — this endpoint must never throw and never 4xx, because a broken
 * profiler should be invisible to the user, not a console full of red.
 */
export function parseBeaconPayload(
  raw: string,
  userId: string,
  deployId: string | null
): ClientMetricRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const metrics = isRecord(parsed) && Array.isArray(parsed.metrics) ? parsed.metrics : null;
  if (!metrics) return [];

  const rows: ClientMetricRow[] = [];
  for (const entry of metrics.slice(0, MAX_METRICS_PER_BEACON)) {
    if (!isRecord(entry)) continue;

    const name = typeof entry.name === "string" ? entry.name : null;
    if (!name || !METRIC_NAMES.has(name)) continue;

    const value = typeof entry.value === "number" ? entry.value : Number.NaN;
    if (!Number.isFinite(value) || value < 0) continue;

    const route = typeof entry.route === "string" ? normalizeRoutePath(entry.route) : null;
    if (!route) continue;

    rows.push({
      name,
      route,
      // CLS is unitless and tiny; the ms ceiling only ever bites pathological timings.
      value: Math.min(value, MAX_METRIC_VALUE_MS),
      rating: shortText(entry.rating),
      navigationType: shortText(entry.navigationType),
      fromRoute: typeof entry.fromRoute === "string" ? normalizeRoutePath(entry.fromRoute) : null,
      platform: shortText(entry.platform),
      metricId: shortText(entry.metricId),
      userId,
      deployId,
    });
  }

  return rows;
}
