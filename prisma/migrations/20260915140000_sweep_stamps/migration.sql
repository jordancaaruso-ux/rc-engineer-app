-- Provenance stamps for the timing sweep ("the timing site opens the run, the driver closes it").
ALTER TABLE "Run" ADD COLUMN "filedBySweepAt" TIMESTAMP(3);
ALTER TABLE "Run" ADD COLUMN "lapsAttachedBySweepAt" TIMESTAMP(3);

ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "sweepFiledAt" TIMESTAMP(3);
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "trackId" TEXT;

CREATE INDEX "ImportedLapTimeSession_trackId_idx" ON "ImportedLapTimeSession"("trackId");
CREATE INDEX "ImportedLapTimeSession_userId_sweepFiledAt_idx"
  ON "ImportedLapTimeSession"("userId", "sweepFiledAt");

ALTER TABLE "ImportedLapTimeSession"
  ADD CONSTRAINT "ImportedLapTimeSession_trackId_fkey"
  FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
