-- Where drivers' phones were when they logged a run at a track; two drivers agreeing set the pin.
-- Additive only.
CREATE TABLE "TrackLocationSighting" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackLocationSighting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackLocationSighting_trackId_userId_key" ON "TrackLocationSighting"("trackId", "userId");

ALTER TABLE "TrackLocationSighting" ADD CONSTRAINT "TrackLocationSighting_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrackLocationSighting" ADD CONSTRAINT "TrackLocationSighting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
