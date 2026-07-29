-- Repairs drift from 20260729120000_perf_instrumentation, which created "PerfSample"
-- without the two cold-start columns its Prisma model declares. recordSample() writes
-- both on every sample and loadColdStartRollup() raw-selects "coldStart", so without
-- these the perf layer silently records nothing and /admin/perf errors.
--
-- Additive only, and the table is empty in every environment (the original migration
-- had never produced a successful insert), so there is nothing to backfill.
--
-- IF NOT EXISTS is required, not defensive padding: dev databases built with
-- `migrate dev`/`db push` already have both columns straight from the model, while
-- production — created by `migrate deploy` of the incomplete migration — does not.
-- Without the guard this fails with 42701 on every dev branch.

ALTER TABLE "PerfSample" ADD COLUMN IF NOT EXISTS "coldStart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PerfSample" ADD COLUMN IF NOT EXISTS "processAgeMs" DOUBLE PRECISION;
