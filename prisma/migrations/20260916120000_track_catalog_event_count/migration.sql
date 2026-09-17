-- Busiest-first ordering for the pre-seeded track catalog. Additive and nullable.
ALTER TABLE "Track" ADD COLUMN "catalogEventCount" INTEGER;
