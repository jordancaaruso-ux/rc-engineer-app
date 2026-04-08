-- True session/run time from timing providers (e.g. LiveRC), UTC. Optional for legacy rows.
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN "sessionCompletedAt" TIMESTAMP(3);

-- Denormalized on run lap sets for labels when comparing runs (same instant for all drivers in a URL import block).
ALTER TABLE "RunImportedLapSet" ADD COLUMN "sessionCompletedAt" TIMESTAMP(3);
