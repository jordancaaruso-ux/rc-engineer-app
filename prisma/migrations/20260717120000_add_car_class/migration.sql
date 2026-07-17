-- Race class / discipline on cars (nullable; ids from src/lib/cars/carClasses.ts).
-- Drives the log-run wizard car-swap rule: same/unknown class keeps the day's
-- tires + prep, different class re-derives them from the new car's last run.
ALTER TABLE "Car" ADD COLUMN "carClass" TEXT;
