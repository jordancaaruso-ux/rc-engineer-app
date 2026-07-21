-- Add missing indexes on foreign-key columns of hot / linearly-growing tables.
-- These columns drive per-user list queries, filter lookups, and (for SetNull/Cascade
-- relations) the parent-delete sweeps — all of which are sequential scans without an index.
--
-- Written with IF NOT EXISTS because production has prior `db push` history and some of
-- these may already exist; index names match Prisma's generated convention (`Model_col_idx`)
-- so `prisma migrate dev` sees no drift. Plain CREATE INDEX (not CONCURRENTLY): these tables
-- are small today, so the build is sub-second. If ever retrofitting on a large table, build
-- that one index CONCURRENTLY out-of-band instead.

-- Car
CREATE INDEX IF NOT EXISTS "Car_userId_idx" ON "Car"("userId");

-- Track
CREATE INDEX IF NOT EXISTS "Track_userId_idx" ON "Track"("userId");

-- Event
CREATE INDEX IF NOT EXISTS "Event_userId_idx" ON "Event"("userId");
CREATE INDEX IF NOT EXISTS "Event_trackLayoutId_idx" ON "Event"("trackLayoutId");

-- EventParticipation
CREATE INDEX IF NOT EXISTS "EventParticipation_controlledTireTypeId_idx" ON "EventParticipation"("controlledTireTypeId");
CREATE INDEX IF NOT EXISTS "EventParticipation_controlledAdditiveTypeId_idx" ON "EventParticipation"("controlledAdditiveTypeId");

-- AdditiveType
CREATE INDEX IF NOT EXISTS "AdditiveType_createdByUserId_idx" ON "AdditiveType"("createdByUserId");

-- TireType
CREATE INDEX IF NOT EXISTS "TireType_createdByUserId_idx" ON "TireType"("createdByUserId");

-- SetupSnapshot
CREATE INDEX IF NOT EXISTS "SetupSnapshot_userId_idx" ON "SetupSnapshot"("userId");
CREATE INDEX IF NOT EXISTS "SetupSnapshot_carId_idx" ON "SetupSnapshot"("carId");
CREATE INDEX IF NOT EXISTS "SetupSnapshot_baseSetupSnapshotId_idx" ON "SetupSnapshot"("baseSetupSnapshotId");

-- SetupImportBatch
CREATE INDEX IF NOT EXISTS "SetupImportBatch_calibrationProfileId_idx" ON "SetupImportBatch"("calibrationProfileId");

-- SetupDocument
CREATE INDEX IF NOT EXISTS "SetupDocument_createdSetupId_idx" ON "SetupDocument"("createdSetupId");
CREATE INDEX IF NOT EXISTS "SetupDocument_calibrationProfileId_idx" ON "SetupDocument"("calibrationProfileId");

-- SetupSheetCalibration
CREATE INDEX IF NOT EXISTS "SetupSheetCalibration_exampleDocumentId_idx" ON "SetupSheetCalibration"("exampleDocumentId");

-- Run
CREATE INDEX IF NOT EXISTS "Run_carId_idx" ON "Run"("carId");
CREATE INDEX IF NOT EXISTS "Run_trackId_idx" ON "Run"("trackId");
CREATE INDEX IF NOT EXISTS "Run_trackLayoutId_idx" ON "Run"("trackLayoutId");
CREATE INDEX IF NOT EXISTS "Run_eventId_idx" ON "Run"("eventId");
CREATE INDEX IF NOT EXISTS "Run_tireSetId_idx" ON "Run"("tireSetId");
CREATE INDEX IF NOT EXISTS "Run_additiveTypeId_idx" ON "Run"("additiveTypeId");
CREATE INDEX IF NOT EXISTS "Run_batteryId_idx" ON "Run"("batteryId");
CREATE INDEX IF NOT EXISTS "Run_setupSnapshotId_idx" ON "Run"("setupSnapshotId");
CREATE INDEX IF NOT EXISTS "Run_sourceSetupDocumentId_idx" ON "Run"("sourceSetupDocumentId");
CREATE INDEX IF NOT EXISTS "Run_sourceSetupCalibrationId_idx" ON "Run"("sourceSetupCalibrationId");

-- ImportedLapTimeSession
CREATE INDEX IF NOT EXISTS "ImportedLapTimeSession_linkedRunId_idx" ON "ImportedLapTimeSession"("linkedRunId");

-- RunImportedLapSet
CREATE INDEX IF NOT EXISTS "RunImportedLapSet_runId_idx" ON "RunImportedLapSet"("runId");

-- VideoAnalysisJob
CREATE INDEX IF NOT EXISTS "VideoAnalysisJob_profileId_idx" ON "VideoAnalysisJob"("profileId");
CREATE INDEX IF NOT EXISTS "VideoAnalysisJob_videoAssetId_idx" ON "VideoAnalysisJob"("videoAssetId");
