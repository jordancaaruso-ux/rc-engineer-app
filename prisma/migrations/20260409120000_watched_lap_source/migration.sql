CREATE TABLE "WatchedLapSource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "driverName" TEXT,
    "carId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSeenSessionCompletedAt" TIMESTAMP(3),
    CONSTRAINT "WatchedLapSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatchedLapSource_userId_updatedAt_idx" ON "WatchedLapSource"("userId", "updatedAt");
CREATE INDEX "WatchedLapSource_userId_sourceUrl_idx" ON "WatchedLapSource"("userId", "sourceUrl");

ALTER TABLE "WatchedLapSource" ADD CONSTRAINT "WatchedLapSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

