-- Allow track delete while preserving event meeting data as legacy snapshots.

ALTER TABLE "Event" ADD COLUMN "trackNameSnapshot" TEXT;
ALTER TABLE "Event" ADD COLUMN "trackLocationSnapshot" TEXT;
ALTER TABLE "Event" ADD COLUMN "legacyTrackJson" JSONB;

ALTER TABLE "Event" ALTER COLUMN "trackId" DROP NOT NULL;

ALTER TABLE "Event" DROP CONSTRAINT "Event_trackId_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Event" e
SET
  "trackNameSnapshot" = t.name,
  "trackLocationSnapshot" = t.location
FROM "Track" t
WHERE e."trackId" = t.id
  AND e."trackNameSnapshot" IS NULL;
