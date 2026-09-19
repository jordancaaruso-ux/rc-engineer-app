-- Off-road: a FRONT tire beside the existing (rear / only) tire columns, each end with its own
-- run count and life of rubber, plus what each end is glued to (insert, wheel, modifications).
-- Additive only.
ALTER TABLE "Run" ADD COLUMN "frontTireTypeId" TEXT;
ALTER TABLE "Run" ADD COLUMN "frontTireRunNumber" INTEGER;
ALTER TABLE "Run" ADD COLUMN "frontTireStintId" TEXT;
ALTER TABLE "Run" ADD COLUMN "frontTireAgeKnown" BOOLEAN;
ALTER TABLE "Run" ADD COLUMN "tireFitment" JSONB;

CREATE INDEX "Run_userId_frontTireStintId_idx" ON "Run"("userId", "frontTireStintId");
CREATE INDEX "Run_frontTireTypeId_idx" ON "Run"("frontTireTypeId");

ALTER TABLE "Run" ADD CONSTRAINT "Run_frontTireTypeId_fkey" FOREIGN KEY ("frontTireTypeId") REFERENCES "TireType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
