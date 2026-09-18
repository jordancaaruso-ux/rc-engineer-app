-- The transponder a sweep-filed session was found by, so "which car?" can pair it. Additive and nullable.
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "sweepChipCode" TEXT;
