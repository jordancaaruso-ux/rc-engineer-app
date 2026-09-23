-- Imported timing sessions: the driver's own name for one, and a "deleted" stamp.
-- Deleting hides the row rather than erasing it, so automatic imports (the evening sweep,
-- event pages, watched links) that upsert by URL leave it alone instead of bringing it back.
-- Additive only.
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "customName" TEXT;
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "hiddenAt" TIMESTAMP(3);
