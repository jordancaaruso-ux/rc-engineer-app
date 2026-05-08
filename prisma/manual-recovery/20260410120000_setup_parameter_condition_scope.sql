-- Manual recovery when Prisma reports P3009 for migration
-- 20260410120000_setup_parameter_condition_scope (failed mid-flight).
-- Run statements in Neon SQL Editor (or psql) against production, then from a shell
-- with DATABASE_URL pointing at the same DB:
--   npx prisma migrate resolve --applied 20260410120000_setup_parameter_condition_scope
-- After that, Vercel `npm run build` (prisma migrate deploy && next build) can proceed.

-- 1) Inspect current failure context (read-only)
-- SELECT migration_name, started_at, finished_at, rolled_back_at, logs
-- FROM "_prisma_migrations"
-- WHERE migration_name = '20260410120000_setup_parameter_condition_scope';

-- SELECT indexname FROM pg_indexes WHERE tablename = 'SetupParameterAggregation';

-- 2) Ensure enum value exists (idempotent; avoids “already exists” on retry)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'SetupAggregationScopeType'
      AND e.enumlabel = 'CAR_PARAMETER_CONDITION'
  ) THEN
    ALTER TYPE "SetupAggregationScopeType" ADD VALUE 'CAR_PARAMETER_CONDITION';
  END IF;
END $$;

-- 3) Remove duplicate rows that would block the new unique index (keeps larger id per key)
DELETE FROM "SetupParameterAggregation" a
USING "SetupParameterAggregation" b
WHERE a."scopeType" = b."scopeType"
  AND a."scopeKey" = b."scopeKey"
  AND a."carId" = b."carId"
  AND a."parameterKey" = b."parameterKey"
  AND a.id < b.id;

-- 4) Drop old unique index if still present; create new one (matches migration.sql)
DROP INDEX IF EXISTS "SetupParameterAggregation_scopeType_carId_parameterKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "SetupParameterAggregation_scopeType_scopeKey_carId_parameterKey_key"
ON "SetupParameterAggregation" ("scopeType", "scopeKey", "carId", "parameterKey");
