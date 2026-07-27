-- Tires are defined by how many runs are on them, not by a named set.
--
-- `tireTypeId` puts the compound directly on the run (it was only reachable via
-- the set). `tireStintId` groups runs sharing one continuous life of rubber; it
-- replaces `tireSetId` as the key the tire-life wear chains group on.
-- `tireAgeKnown` is false when the driver said "not sure how many runs" (e.g. a
-- set they were given) — the count is then relative, so k→k+1 deltas still chain
-- but anything anchored to absolute tire age must exclude those stints.
--
-- `TireSet` and `Run.tireSetId` are left in place, unread, so existing history
-- stays intact — the same treatment `Car.carClass` got.

ALTER TABLE "Run" ADD COLUMN "tireTypeId" TEXT;
ALTER TABLE "Run" ADD COLUMN "tireStintId" TEXT;
ALTER TABLE "Run" ADD COLUMN "tireAgeKnown" BOOLEAN NOT NULL DEFAULT true;

-- Backfill the compound from the set the run went out on.
UPDATE "Run" r
SET "tireTypeId" = ts."tireTypeId"
FROM "TireSet" ts
WHERE r."tireSetId" = ts."id" AND ts."tireTypeId" IS NOT NULL;

-- Backfill stints: within a TireSet, tireRunNumber is monotonic and never resets
-- — a set has exactly one life — so each historical set maps 1:1 onto a stint.
UPDATE "Run" SET "tireStintId" = "tireSetId" WHERE "tireSetId" IS NOT NULL;

ALTER TABLE "Run" ADD CONSTRAINT "Run_tireTypeId_fkey"
  FOREIGN KEY ("tireTypeId") REFERENCES "TireType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Run_userId_tireStintId_idx" ON "Run"("userId", "tireStintId");
CREATE INDEX "Run_tireTypeId_idx" ON "Run"("tireTypeId");
