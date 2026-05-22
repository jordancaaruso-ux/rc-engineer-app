-- AlterTable
ALTER TABLE "VideoAnalysisJob" ADD COLUMN IF NOT EXISTS "analysisMode" TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE "VideoAnalysisJob" ADD COLUMN IF NOT EXISTS "manualJson" JSONB;
