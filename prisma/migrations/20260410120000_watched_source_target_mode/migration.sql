-- Add explicit targeting semantics for watched sources.
ALTER TABLE "WatchedLapSource"
ADD COLUMN     "targetMode" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "targetClass" TEXT,
ADD COLUMN     "targetDriverOverride" TEXT;

-- Best-effort backfill: old rows with a driverName behave like driver-targeted practice sources.
UPDATE "WatchedLapSource"
SET "targetMode" = 'driver',
    "targetDriverOverride" = COALESCE(NULLIF(TRIM("driverName"), ''), "targetDriverOverride")
WHERE "driverName" IS NOT NULL AND TRIM("driverName") <> '';

