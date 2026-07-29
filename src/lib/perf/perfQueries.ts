import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Rollups for /admin/perf.
 *
 * Percentiles are computed in Postgres via `percentile_cont`, not in JS — pulling every
 * sample into the node process to sort it would make the perf page the slowest page in
 * the app, which would be a poor look.
 */

export type RouteRollup = {
  route: string;
  kind: string;
  samples: number;
  p50: number;
  p75: number;
  p95: number;
  avgDbMs: number;
  avgQueries: number;
};

export type QueryRollup = {
  model: string;
  operation: string;
  appearances: number;
  p95: number;
  totalMs: number;
};

export type ClientRollup = {
  name: string;
  route: string;
  platform: string | null;
  samples: number;
  p75: number;
};

/** Routes with fewer samples than this are noise, not a ranking. */
const MIN_SAMPLES = 3;

export async function loadRouteRollups(days: number): Promise<RouteRollup[]> {
  return prisma.$queryRaw<RouteRollup[]>`
    SELECT
      route,
      kind,
      count(*)::int AS samples,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY "totalMs")::float8 AS p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY "totalMs")::float8 AS p75,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs")::float8 AS p95,
      avg("dbMs")::float8 AS "avgDbMs",
      avg("queryCount")::float8 AS "avgQueries"
    FROM "PerfSample"
    WHERE "createdAt" > now() - (${days}::int * interval '1 day')
    GROUP BY route, kind
    HAVING count(*) >= ${MIN_SAMPLES}
    ORDER BY p95 DESC
    LIMIT 60
  `;
}

export async function loadQueryRollups(days: number): Promise<QueryRollup[]> {
  // `slowest` only holds the top 5 per request, so this ranks the queries that dominate
  // slow requests — not every query the app runs. Ordered by cumulative time, which is
  // what actually shows up as page latency.
  return prisma.$queryRaw<QueryRollup[]>`
    SELECT
      q->>'m' AS model,
      q->>'o' AS operation,
      count(*)::int AS appearances,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (q->>'ms')::float8)::float8 AS p95,
      sum((q->>'ms')::float8)::float8 AS "totalMs"
    FROM "PerfSample", jsonb_array_elements("slowest") q
    WHERE "createdAt" > now() - (${days}::int * interval '1 day')
      AND "slowest" IS NOT NULL
    GROUP BY 1, 2
    ORDER BY "totalMs" DESC
    LIMIT 25
  `;
}

export async function loadClientRollups(days: number): Promise<ClientRollup[]> {
  // p75 is the Core Web Vitals convention — the number Google grades you on.
  return prisma.$queryRaw<ClientRollup[]>`
    SELECT
      name,
      route,
      platform,
      count(*)::int AS samples,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY value)::float8 AS p75
    FROM "PerfClientMetric"
    WHERE "createdAt" > now() - (${days}::int * interval '1 day')
    GROUP BY name, route, platform
    HAVING count(*) >= ${MIN_SAMPLES}
    ORDER BY name ASC, p75 DESC
    LIMIT 80
  `;
}

export type ColdStartRollup = {
  bucket: string;
  samples: number;
  p50: number;
  p95: number;
};

/**
 * Cold vs warm, side by side. This is the row that says whether a slow page is slow
 * because of its queries or because the lambda had just booted.
 */
export async function loadColdStartRollup(days: number): Promise<ColdStartRollup[]> {
  return prisma.$queryRaw<ColdStartRollup[]>`
    SELECT
      CASE WHEN "coldStart" THEN 'cold (first request of a process)' ELSE 'warm' END AS bucket,
      count(*)::int AS samples,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY "totalMs")::float8 AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalMs")::float8 AS p95
    FROM "PerfSample"
    WHERE "createdAt" > now() - (${days}::int * interval '1 day')
    GROUP BY 1
    ORDER BY 1
  `;
}

export type PerfCounts = { serverSamples: number; clientSamples: number };

export async function loadPerfCounts(days: number): Promise<PerfCounts> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [serverSamples, clientSamples] = await Promise.all([
    prisma.perfSample.count({ where: { createdAt: { gt: since } } }),
    prisma.perfClientMetric.count({ where: { createdAt: { gt: since } } }),
  ]);
  return { serverSamples, clientSamples };
}

/** Guard against a hand-typed `?days=` turning into an unbounded scan. */
export function parseDaysParam(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(Math.max(Math.round(parsed), 1), 90);
}
