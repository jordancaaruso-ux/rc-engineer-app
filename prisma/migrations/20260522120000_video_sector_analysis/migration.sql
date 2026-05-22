-- CreateEnum
CREATE TYPE "VideoAnalysisJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "TrackCameraProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main camera',
    "referenceImagePath" TEXT,
    "lensJson" JSONB,
    "lastAlignmentJson" JSONB,

    CONSTRAINT "TrackCameraProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackSectorLine" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profileId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "x1" DOUBLE PRECISION NOT NULL,
    "y1" DOUBLE PRECISION NOT NULL,
    "x2" DOUBLE PRECISION NOT NULL,
    "y2" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrackSectorLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAnalysisJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VideoAnalysisJobStatus" NOT NULL DEFAULT 'PENDING',
    "trackId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "videoAssetId" TEXT,
    "runId" TEXT,
    "alignmentJson" JSONB,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "idCorrectionsJson" JSONB,

    CONSTRAINT "VideoAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "VideoAsset" ADD COLUMN "localAnalysisPath" TEXT,
ADD COLUMN "runId" TEXT,
ADD COLUMN "trackId" TEXT;

-- CreateIndex
CREATE INDEX "TrackCameraProfile_userId_trackId_idx" ON "TrackCameraProfile"("userId", "trackId");
CREATE INDEX "TrackCameraProfile_trackId_idx" ON "TrackCameraProfile"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackSectorLine_profileId_lineKey_key" ON "TrackSectorLine"("profileId", "lineKey");
CREATE INDEX "TrackSectorLine_profileId_sortOrder_idx" ON "TrackSectorLine"("profileId", "sortOrder");

-- CreateIndex
CREATE INDEX "VideoAnalysisJob_userId_createdAt_idx" ON "VideoAnalysisJob"("userId", "createdAt");
CREATE INDEX "VideoAnalysisJob_trackId_idx" ON "VideoAnalysisJob"("trackId");
CREATE INDEX "VideoAnalysisJob_runId_idx" ON "VideoAnalysisJob"("runId");

-- CreateIndex
CREATE INDEX "VideoAsset_runId_idx" ON "VideoAsset"("runId");
CREATE INDEX "VideoAsset_trackId_idx" ON "VideoAsset"("trackId");

-- AddForeignKey
ALTER TABLE "TrackCameraProfile" ADD CONSTRAINT "TrackCameraProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackCameraProfile" ADD CONSTRAINT "TrackCameraProfile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackSectorLine" ADD CONSTRAINT "TrackSectorLine_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TrackCameraProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAnalysisJob" ADD CONSTRAINT "VideoAnalysisJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAnalysisJob" ADD CONSTRAINT "VideoAnalysisJob_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAnalysisJob" ADD CONSTRAINT "VideoAnalysisJob_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TrackCameraProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAnalysisJob" ADD CONSTRAINT "VideoAnalysisJob_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "VideoAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoAnalysisJob" ADD CONSTRAINT "VideoAnalysisJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
