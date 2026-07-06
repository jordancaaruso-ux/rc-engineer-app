-- CreateEnum
CREATE TYPE "TrackDirection" AS ENUM ('CW', 'CCW');

-- CreateTable
CREATE TABLE "TrackLayout" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "trackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TrackLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackLayout_trackId_sortOrder_idx" ON "TrackLayout"("trackId", "sortOrder");

-- CreateIndex
CREATE INDEX "TrackLayout_userId_idx" ON "TrackLayout"("userId");

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "trackLayoutId" TEXT,
ADD COLUMN     "trackLayoutNameSnapshot" TEXT,
ADD COLUMN     "trackDirection" "TrackDirection";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "trackLayoutId" TEXT,
ADD COLUMN     "trackLayoutNameSnapshot" TEXT,
ADD COLUMN     "trackDirection" "TrackDirection";

-- AddForeignKey
ALTER TABLE "TrackLayout" ADD CONSTRAINT "TrackLayout_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackLayout" ADD CONSTRAINT "TrackLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_trackLayoutId_fkey" FOREIGN KEY ("trackLayoutId") REFERENCES "TrackLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_trackLayoutId_fkey" FOREIGN KEY ("trackLayoutId") REFERENCES "TrackLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
