-- CreateTable
CREATE TABLE "ImportedLapTimeSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "parserId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'timing_url',
    "parsedPayload" JSONB NOT NULL,
    "linkedRunId" TEXT,
    "linkedEventId" TEXT,

    CONSTRAINT "ImportedLapTimeSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportedLapTimeSession_userId_createdAt_idx" ON "ImportedLapTimeSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedLapTimeSession_userId_sourceUrl_idx" ON "ImportedLapTimeSession"("userId", "sourceUrl");

-- AddForeignKey
ALTER TABLE "ImportedLapTimeSession" ADD CONSTRAINT "ImportedLapTimeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedLapTimeSession" ADD CONSTRAINT "ImportedLapTimeSession_linkedRunId_fkey" FOREIGN KEY ("linkedRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedLapTimeSession" ADD CONSTRAINT "ImportedLapTimeSession_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
