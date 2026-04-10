-- Engineer Summary cache + optional Deep Dive answers (per run)
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "engineerSummaryJson" JSONB;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "engineerSummaryRefRunId" TEXT;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "engineerSummaryComputedAt" TIMESTAMP(3);
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "engineerDeepDiveJson" JSONB;
