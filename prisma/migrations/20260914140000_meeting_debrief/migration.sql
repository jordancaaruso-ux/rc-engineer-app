-- The driver's own note on a meeting, written after the day. One per driver per meeting,
-- keyed on the Sessions group (an event, or the same track on the same local day).
CREATE TABLE "MeetingDebrief" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingKey" TEXT NOT NULL,
    "eventId" TEXT,
    "localDayKey" TEXT NOT NULL,
    "trackKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "aiSummary" TEXT,
    "aiSummaryAt" TIMESTAMP(3),
    "aiSummarySourceHash" TEXT,

    CONSTRAINT "MeetingDebrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingDebrief_userId_meetingKey_key" ON "MeetingDebrief"("userId", "meetingKey");

CREATE INDEX "MeetingDebrief_userId_eventId_idx" ON "MeetingDebrief"("userId", "eventId");

CREATE INDEX "MeetingDebrief_userId_localDayKey_trackKey_idx" ON "MeetingDebrief"("userId", "localDayKey", "trackKey");

ALTER TABLE "MeetingDebrief" ADD CONSTRAINT "MeetingDebrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingDebrief" ADD CONSTRAINT "MeetingDebrief_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
