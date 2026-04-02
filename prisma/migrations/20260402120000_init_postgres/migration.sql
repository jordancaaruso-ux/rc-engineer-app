-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActionItemSourceType" AS ENUM ('RUN', 'MANUAL');

-- CreateEnum
CREATE TYPE "SetupDocumentSourceType" AS ENUM ('PDF', 'IMAGE');

-- CreateEnum
CREATE TYPE "SetupDocumentParseStatus" AS ENUM ('PENDING', 'PARSED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SetupDocumentImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED', 'COMPLETED_WITH_WARNINGS');

-- CreateEnum
CREATE TYPE "SetupDocumentImportOutcome" AS ENUM ('COMPLETED_TRUSTED', 'COMPLETED_WITH_WARNINGS', 'PARTIAL_DIAGNOSTIC', 'FAILED');

-- CreateEnum
CREATE TYPE "SetupImportDatasetReviewStatus" AS ENUM ('UNSET', 'NOT_CONFIRMED', 'CONFIRMED_ACCURATE');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('TESTING', 'PRACTICE', 'RACE_MEETING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "normKey" TEXT NOT NULL,
    "sourceType" "ActionItemSourceType" NOT NULL,
    "sourceRunId" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Car" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chassis" TEXT,
    "notes" TEXT,
    "setupSheetTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Car_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "layout" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavouriteTrack" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavouriteTrack_pkey" PRIMARY KEY ("userId","trackId")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TireSet" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL DEFAULT 1,
    "initialRunCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TireSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "carId" TEXT,
    "data" JSONB NOT NULL,
    "baseSetupSnapshotId" TEXT,
    "setupDeltaJson" JSONB,

    CONSTRAINT "SetupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupImportBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "calibrationProfileId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SetupImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupDocument" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sourceType" "SetupDocumentSourceType" NOT NULL,
    "parserType" TEXT,
    "parseStatus" "SetupDocumentParseStatus" NOT NULL DEFAULT 'PENDING',
    "importStatus" "SetupDocumentImportStatus" NOT NULL DEFAULT 'PENDING',
    "importOutcome" "SetupDocumentImportOutcome",
    "currentStage" TEXT,
    "lastCompletedStage" TEXT,
    "stageStartedAt" TIMESTAMP(3),
    "stageFinishedAt" TIMESTAMP(3),
    "importDebugLogJson" JSONB,
    "importDiagnosticJson" JSONB,
    "importErrorMessage" TEXT,
    "parseStartedAt" TIMESTAMP(3),
    "parseFinishedAt" TIMESTAMP(3),
    "calibrationResolvedProfileId" TEXT,
    "calibrationResolvedSource" TEXT,
    "calibrationResolvedDebug" TEXT,
    "calibrationUsedIsForcedDefault" BOOLEAN,
    "extractedText" TEXT,
    "parsedDataJson" JSONB,
    "parsedSetupManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "calibrationProfileId" TEXT,
    "parsedCalibrationProfileId" TEXT,
    "parsedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "setupImportBatchId" TEXT,
    "importDatasetReviewStatus" "SetupImportDatasetReviewStatus" NOT NULL DEFAULT 'UNSET',
    "eligibleForAggregationDataset" BOOLEAN NOT NULL DEFAULT false,
    "createdSetupId" TEXT,

    CONSTRAINT "SetupDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupSheetCalibration" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "calibrationDataJson" JSONB NOT NULL,
    "exampleDocumentId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SetupSheetCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionLabel" TEXT,
    "sessionType" "SessionType" NOT NULL DEFAULT 'TESTING',
    "meetingSessionType" TEXT,
    "meetingSessionCode" TEXT,
    "carNameSnapshot" TEXT,
    "trackNameSnapshot" TEXT,
    "userId" TEXT NOT NULL,
    "carId" TEXT,
    "trackId" TEXT,
    "eventId" TEXT,
    "tireSetId" TEXT,
    "tireRunNumber" INTEGER NOT NULL DEFAULT 1,
    "setupSnapshotId" TEXT NOT NULL,
    "sourceSetupDocumentId" TEXT,
    "sourceSetupCalibrationId" TEXT,
    "renderedSetupPdfPath" TEXT,
    "renderedSetupPdfGeneratedAt" TIMESTAMP(3),
    "setupPdfRenderVersion" INTEGER NOT NULL DEFAULT 1,
    "lapTimes" JSONB NOT NULL DEFAULT '[]',
    "lapSession" JSONB,
    "notes" TEXT,
    "driverNotes" TEXT,
    "handlingProblems" TEXT,
    "suggestedChanges" TEXT,
    "appliedChanges" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunImportedLapSet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "driverId" TEXT,
    "driverName" TEXT NOT NULL,
    "displayName" TEXT,
    "surname" TEXT,
    "normalizedName" TEXT NOT NULL,
    "isPrimaryUser" BOOLEAN NOT NULL DEFAULT false,
    "runId" TEXT NOT NULL,

    CONSTRAINT "RunImportedLapSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunImportedLap" (
    "id" TEXT NOT NULL,
    "lapNumber" INTEGER NOT NULL,
    "lapTimeSeconds" DOUBLE PRECISION NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "lapSetId" TEXT NOT NULL,

    CONSTRAINT "RunImportedLap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ActionItem_userId_isArchived_createdAt_idx" ON "ActionItem"("userId", "isArchived", "createdAt");

-- CreateIndex
CREATE INDEX "ActionItem_userId_normKey_isArchived_idx" ON "ActionItem"("userId", "normKey", "isArchived");

-- CreateIndex
CREATE INDEX "SetupImportBatch_userId_createdAt_idx" ON "SetupImportBatch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SetupDocument_userId_createdAt_idx" ON "SetupDocument"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SetupDocument_userId_parseStatus_idx" ON "SetupDocument"("userId", "parseStatus");

-- CreateIndex
CREATE INDEX "SetupDocument_setupImportBatchId_idx" ON "SetupDocument"("setupImportBatchId");

-- CreateIndex
CREATE INDEX "SetupSheetCalibration_userId_createdAt_idx" ON "SetupSheetCalibration"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_userId_key_key" ON "AppSetting"("userId", "key");

-- CreateIndex
CREATE INDEX "RunImportedLap_lapSetId_lapNumber_idx" ON "RunImportedLap"("lapSetId", "lapNumber");

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavouriteTrack" ADD CONSTRAINT "FavouriteTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavouriteTrack" ADD CONSTRAINT "FavouriteTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_baseSetupSnapshotId_fkey" FOREIGN KEY ("baseSetupSnapshotId") REFERENCES "SetupSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupImportBatch" ADD CONSTRAINT "SetupImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupImportBatch" ADD CONSTRAINT "SetupImportBatch_calibrationProfileId_fkey" FOREIGN KEY ("calibrationProfileId") REFERENCES "SetupSheetCalibration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_calibrationProfileId_fkey" FOREIGN KEY ("calibrationProfileId") REFERENCES "SetupSheetCalibration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_setupImportBatchId_fkey" FOREIGN KEY ("setupImportBatchId") REFERENCES "SetupImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_createdSetupId_fkey" FOREIGN KEY ("createdSetupId") REFERENCES "SetupSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSheetCalibration" ADD CONSTRAINT "SetupSheetCalibration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSheetCalibration" ADD CONSTRAINT "SetupSheetCalibration_exampleDocumentId_fkey" FOREIGN KEY ("exampleDocumentId") REFERENCES "SetupDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_tireSetId_fkey" FOREIGN KEY ("tireSetId") REFERENCES "TireSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_setupSnapshotId_fkey" FOREIGN KEY ("setupSnapshotId") REFERENCES "SetupSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_sourceSetupDocumentId_fkey" FOREIGN KEY ("sourceSetupDocumentId") REFERENCES "SetupDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_sourceSetupCalibrationId_fkey" FOREIGN KEY ("sourceSetupCalibrationId") REFERENCES "SetupSheetCalibration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunImportedLapSet" ADD CONSTRAINT "RunImportedLapSet_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunImportedLap" ADD CONSTRAINT "RunImportedLap_lapSetId_fkey" FOREIGN KEY ("lapSetId") REFERENCES "RunImportedLapSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

