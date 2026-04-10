-- Event-scoped LiveRC URLs + detection watermarks
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "practiceSourceUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "resultsSourceUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "raceClass" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "practiceLastSeenSessionCompletedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "resultsLastSeenSessionCompletedAt" TIMESTAMP(3);

-- Imported session: event detection metadata
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN IF NOT EXISTS "eventDetectionSource" TEXT;
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN IF NOT EXISTS "eventRaceClass" TEXT;

CREATE INDEX IF NOT EXISTS "ImportedLapTimeSession_linkedEventId_idx" ON "ImportedLapTimeSession"("linkedEventId");

-- Run: primary detected/imported session (duplicate prevention + incomplete prompts)
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "importedLapTimeSessionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Run_importedLapTimeSessionId_key" ON "Run"("importedLapTimeSessionId");

ALTER TABLE "Run" ADD CONSTRAINT "Run_importedLapTimeSessionId_fkey" FOREIGN KEY ("importedLapTimeSessionId") REFERENCES "ImportedLapTimeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
