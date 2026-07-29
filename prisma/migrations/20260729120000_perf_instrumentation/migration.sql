-- Production performance instrumentation.
--
-- Two write-only sinks, both gated behind PERF_INSTRUMENTATION=1 and pruned past
-- PERF_RETENTION_DAYS. Neither is read on a request path — only by /admin/perf.
--
-- Deliberately no foreign key to "User": these are high-churn diagnostic rows, and a
-- loose userId lets the retention prune bulk-delete without cascade work. It also means
-- deleting a user never blocks on, or silently rewrites, months of perf history.

-- One row per instrumented server request (RSC page render or API route handler).
CREATE TABLE "PerfSample" (
  "id"         TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind"       TEXT NOT NULL,
  "route"      TEXT NOT NULL,
  "method"     TEXT,
  "status"     INTEGER,
  "totalMs"    DOUBLE PRECISION NOT NULL,
  "dbMs"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "queryCount" INTEGER NOT NULL DEFAULT 0,
  "phases"     JSONB,
  "slowest"    JSONB,
  "userId"     TEXT,
  "deployId"   TEXT,

  CONSTRAINT "PerfSample_pkey" PRIMARY KEY ("id")
);

-- ("route", "createdAt") serves the per-route rollups; ("createdAt") serves the prune.
CREATE INDEX "PerfSample_createdAt_idx" ON "PerfSample"("createdAt");
CREATE INDEX "PerfSample_route_createdAt_idx" ON "PerfSample"("route", "createdAt");

-- Client RUM: web vitals plus soft-navigation timing, beaconed from the browser and the
-- Capacitor webview.
CREATE TABLE "PerfClientMetric" (
  "id"             TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "name"           TEXT NOT NULL,
  "route"          TEXT NOT NULL,
  "value"          DOUBLE PRECISION NOT NULL,
  "rating"         TEXT,
  "navigationType" TEXT,
  "fromRoute"      TEXT,
  "platform"       TEXT,
  "userId"         TEXT,
  "deployId"       TEXT,
  "metricId"       TEXT,

  CONSTRAINT "PerfClientMetric_pkey" PRIMARY KEY ("id")
);

-- Paired with skipDuplicates on the insert, this is what makes a retried beacon or a
-- React StrictMode double-report idempotent without a read-before-write.
CREATE UNIQUE INDEX "PerfClientMetric_metricId_name_key" ON "PerfClientMetric"("metricId", "name");
CREATE INDEX "PerfClientMetric_createdAt_idx" ON "PerfClientMetric"("createdAt");
CREATE INDEX "PerfClientMetric_name_route_createdAt_idx" ON "PerfClientMetric"("name", "route", "createdAt");
