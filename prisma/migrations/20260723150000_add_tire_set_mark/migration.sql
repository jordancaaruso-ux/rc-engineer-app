-- Optional physical mark on a tire set (sidewall number / race-control mark).
-- Nullable; existing rows backfill to NULL (fall back to wear identity).
ALTER TABLE "TireSet" ADD COLUMN "mark" TEXT;
