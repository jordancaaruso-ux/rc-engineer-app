-- Required 1-10 overall car rating captured when a run is marked complete.
-- Nullable in DB so existing rows and drafts continue to load; the API enforces
-- presence at "Run complete" time.

ALTER TABLE "Run" ADD COLUMN "carRating" INTEGER;

CREATE INDEX "Run_userId_carId_carRating_idx" ON "Run"("userId", "carId", "carRating");
