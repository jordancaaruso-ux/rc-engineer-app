-- Global events (per track/meeting) with per-user EventParticipation for notes and spec tire.

-- 1. Participation table
CREATE TABLE "EventParticipation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "notes" TEXT,
    "controlledTireLabel" TEXT,
    "controlledTireTypeId" TEXT,
    "pinnedAt" TIMESTAMP(3),

    CONSTRAINT "EventParticipation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventParticipation_userId_eventId_key" ON "EventParticipation"("userId", "eventId");
CREATE INDEX "EventParticipation_eventId_idx" ON "EventParticipation"("eventId");

ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_controlledTireTypeId_fkey"
  FOREIGN KEY ("controlledTireTypeId") REFERENCES "TireType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Copy per-user fields from Event into participation rows (one row per legacy event owner)
INSERT INTO "EventParticipation" ("id", "createdAt", "userId", "eventId", "notes", "controlledTireLabel", "controlledTireTypeId")
SELECT
  'ep_' || "id",
  "createdAt",
  "userId",
  "id",
  "notes",
  "controlledTireLabel",
  "controlledTireTypeId"
FROM "Event"
WHERE "userId" IS NOT NULL;

-- 3. Drop personal columns from Event (now on EventParticipation)
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_controlledTireTypeId_fkey";
ALTER TABLE "Event" DROP COLUMN "notes";
ALTER TABLE "Event" DROP COLUMN "controlledTireLabel";
ALTER TABLE "Event" DROP COLUMN "controlledTireTypeId";

-- 4. Creator attribution only (events are shared globally)
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_userId_fkey";
ALTER TABLE "Event" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Event" ADD CONSTRAINT "Event_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. trackId required for track-linked meetings
DELETE FROM "Event" WHERE "trackId" IS NULL;

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_trackId_fkey";
ALTER TABLE "Event" ALTER COLUMN "trackId" SET NOT NULL;
ALTER TABLE "Event" ADD CONSTRAINT "Event_trackId_fkey"
  FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Lookup indexes (partial UNIQUE on results URL deferred until dedupe script runs)
CREATE INDEX IF NOT EXISTS "Event_trackId_startDate_idx" ON "Event"("trackId", "startDate");
CREATE INDEX IF NOT EXISTS "Event_trackId_endDate_idx" ON "Event"("trackId", "endDate");
