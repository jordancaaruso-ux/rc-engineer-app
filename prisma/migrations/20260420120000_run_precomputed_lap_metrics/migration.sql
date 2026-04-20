-- Materialized lap summary metrics on Run: list views (Sessions / dashboard)
-- read these instead of recomputing best / avg-top-5 from the `lapTimes` JSON
-- array on every row. Nullable so legacy runs written before this column
-- existed continue to work; callers fall back to computing from the lap
-- arrays when null.
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "bestLapSeconds" DOUBLE PRECISION;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "avgTop5LapSeconds" DOUBLE PRECISION;
