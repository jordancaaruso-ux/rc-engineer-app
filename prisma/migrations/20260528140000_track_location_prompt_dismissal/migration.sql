-- CreateTable
CREATE TABLE "TrackLocationRunPromptDismissal" (
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackLocationRunPromptDismissal_pkey" PRIMARY KEY ("userId","trackId")
);

-- CreateIndex
CREATE INDEX "TrackLocationRunPromptDismissal_trackId_idx" ON "TrackLocationRunPromptDismissal"("trackId");

-- AddForeignKey
ALTER TABLE "TrackLocationRunPromptDismissal" ADD CONSTRAINT "TrackLocationRunPromptDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackLocationRunPromptDismissal" ADD CONSTRAINT "TrackLocationRunPromptDismissal_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
