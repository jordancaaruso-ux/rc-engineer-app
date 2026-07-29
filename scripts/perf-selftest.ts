/**
 * End-to-end proof that the perf layer actually records, with no browser and no
 * running Next server.
 *
 * Run: `npm run test:perf-instrumentation`
 * (dotenv-cli supplies DATABASE_URL and forces PERF_INSTRUMENTATION=1; the
 *  `--conditions=react-server` flag is required because the store imports `server-only`.)
 *
 * Covers the pieces that only work together: the Prisma client extension, the
 * AsyncLocalStorage request scope, phase recording via `perfSpan`, the row written to
 * `PerfSample`, and the raw SQL behind /admin/perf.
 *
 * Writes a handful of rows under the `/selftest` route key and deletes them again.
 */
import assert from "node:assert/strict";

import { parseBeaconPayload } from "@/lib/perf/beaconPayload";
import { PERF_ENABLED } from "@/lib/perf/perfConfig";
import {
  loadClientRollups,
  loadPerfCounts,
  loadQueryRollups,
  loadRouteRollups,
} from "@/lib/perf/perfQueries";
import type { PerfStore } from "@/lib/perf/perfStore";
import { createPerfStore, enterApiPerfScope, runWithPerf } from "@/lib/perf/perfStore";
import { flushPerfSample } from "@/lib/perf/recordSample";
import { buildServerTimingHeader } from "@/lib/perf/serverTiming";
import { perfSpan } from "@/lib/perfLog";
import { prisma } from "@/lib/prisma";

const SELFTEST_ROUTE = "/selftest";

async function cleanup(): Promise<void> {
  await prisma.perfSample.deleteMany({ where: { route: SELFTEST_ROUTE } });
  await prisma.perfClientMetric.deleteMany({ where: { route: SELFTEST_ROUTE } });
}

/**
 * Regression guard for the AsyncLocalStorage scope, which is the subtlest thing here.
 *
 * Mirrors the real shape exactly: a route handler calls `getAuthenticatedApiUser`, that
 * helper opens the scope synchronously before its own first await, and the handler then
 * runs queries *after* awaiting it. The first cut opened the scope after an await and
 * every API route silently recorded `q=0` — the units all passed, only production data
 * exposed it.
 */
async function fakeAuthHelper(): Promise<PerfStore | null> {
  const store = enterApiPerfScope();
  await Promise.resolve(); // stands in for `await headers()` / `await auth()`
  await prisma.user.count(); // a query inside the helper
  return store;
}

async function fakeRouteHandler(): Promise<PerfStore | null> {
  const store = await fakeAuthHelper();
  // The query that broke: it runs in the handler's continuation, not the helper's.
  await prisma.car.count();
  return store;
}

async function main(): Promise<void> {
  assert.equal(
    PERF_ENABLED,
    true,
    "PERF_INSTRUMENTATION=1 must be set before import — run this via `npm run test:perf-instrumentation`."
  );

  await cleanup();

  const store = createPerfStore("api");
  store.seeded = true;
  store.route = SELFTEST_ROUTE;
  store.method = "GET";

  await runWithPerf(store, async () => {
    await prisma.user.count();
    // Raw queries go through the same extension, attributed to the `$raw` pseudo-model.
    await prisma.$queryRaw`SELECT 1`;
    await perfSpan("selftest", async () => {
      await prisma.car.count();
    });
  });

  assert.equal(store.queryCount, 3, `expected 3 attributed queries, got ${store.queryCount}`);
  assert.ok(store.dbMs > 0, "dbMs should be positive");
  assert.equal(store.slowest.length, 3, "all three queries should be in the slowest list");
  assert.ok(
    store.slowest.some((q) => q.m === "$raw"),
    "raw queries must be attributed"
  );
  assert.ok(
    store.slowest[0] !== undefined &&
      store.slowest[1] !== undefined &&
      store.slowest[0].ms >= store.slowest[1].ms,
    "slowest list must be sorted descending"
  );
  assert.ok((store.phases.selftest ?? 0) > 0, "perfSpan should have recorded a phase");

  const header = buildServerTimingHeader(store, 123.456);
  assert.ok(header.startsWith("total;dur=123.5"), `unexpected header: ${header}`);

  console.log("[perf-selftest] queries:", store.queryCount, "dbMs:", Math.round(store.dbMs));
  console.log("[perf-selftest] slowest:", JSON.stringify(store.slowest));
  console.log("[perf-selftest] Server-Timing:", header);

  // --- The row actually reaches PerfSample -------------------------------------------
  // Enough samples that the rollups' `HAVING count(*) >= 3` threshold is met.
  for (let i = 0; i < 3; i += 1) {
    const sample = createPerfStore("api");
    sample.seeded = true;
    sample.route = SELFTEST_ROUTE;
    sample.method = "GET";
    sample.queryCount = store.queryCount;
    sample.dbMs = store.dbMs;
    sample.slowest = store.slowest;
    sample.phases = { ...store.phases };
    await flushPerfSample(sample, { status: 200, totalMs: 100 + i });
  }

  const written = await prisma.perfSample.findMany({ where: { route: SELFTEST_ROUTE } });
  assert.equal(written.length, 3, `expected 3 PerfSample rows, got ${written.length}`);
  assert.ok(written[0]?.phases != null, "phases JSON should round-trip");
  assert.ok(written[0]?.slowest != null, "slowest JSON should round-trip");

  // --- Client beacon path --------------------------------------------------------------
  const rows = parseBeaconPayload(
    JSON.stringify({
      metrics: Array.from({ length: 3 }, (_, i) => ({
        name: "LCP",
        route: SELFTEST_ROUTE,
        value: 900 + i,
        metricId: `selftest-${i}`,
        platform: "web",
      })),
    }),
    written[0]?.id ?? "selftest-user",
    null
  );
  assert.equal(rows.length, 3, "beacon payload should yield 3 rows");
  await prisma.perfClientMetric.createMany({ data: rows, skipDuplicates: true });
  // Re-inserting the same beacon must be a no-op, not a duplicate.
  await prisma.perfClientMetric.createMany({ data: rows, skipDuplicates: true });
  const clientCount = await prisma.perfClientMetric.count({ where: { route: SELFTEST_ROUTE } });
  assert.equal(clientCount, 3, `duplicate beacon was not absorbed: ${clientCount} rows`);

  // --- The raw SQL behind /admin/perf actually runs -------------------------------------
  const [routes, queries, client, counts] = await Promise.all([
    loadRouteRollups(1),
    loadQueryRollups(1),
    loadClientRollups(1),
    loadPerfCounts(1),
  ]);
  const selfRoute = routes.find((r) => r.route === SELFTEST_ROUTE);
  assert.ok(selfRoute, "route rollup should include the selftest route");
  assert.equal(selfRoute.samples, 3);
  assert.ok(selfRoute.p95 >= selfRoute.p50, "p95 must not be below p50");
  assert.ok(queries.length > 0, "query rollup (jsonb_array_elements) returned nothing");
  assert.ok(
    client.some((c) => c.route === SELFTEST_ROUTE),
    "client rollup should include the selftest route"
  );
  assert.ok(counts.serverSamples >= 3);

  console.log(
    "[perf-selftest] rollups ok — routes:",
    routes.length,
    "queries:",
    queries.length,
    "client:",
    client.length
  );

  await cleanup();

  // --- ALS scope propagation (run last: enterWith leaks into the rest of this context) --
  const scoped = await fakeRouteHandler();
  assert.ok(scoped, "enterApiPerfScope returned nothing");
  assert.equal(
    scoped.queryCount,
    2,
    `scope did not reach the caller's continuation — got q=${scoped.queryCount}, expected 2`
  );
  console.log("[perf-selftest] ALS scope reaches caller continuations (q=2)");

  console.log("[perf-selftest] OK");
}

main()
  .catch((error: unknown) => {
    console.error("[perf-selftest] FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
