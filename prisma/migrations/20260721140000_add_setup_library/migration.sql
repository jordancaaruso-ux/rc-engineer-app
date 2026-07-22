-- Setup library: named, reusable setups on a car, plus a per-model manufacturer kit setup.
--
-- Strictly additive: three nullable/defaulted columns and one index. Nothing is dropped,
-- renamed, or retyped, so every existing read keeps working unchanged. In particular
-- `isLibrary` defaults to false, so all pre-existing SetupSnapshot rows stay exactly what
-- they are today (per-run snapshots) and cannot appear in the new library lists.
--
-- Aggregations are unaffected by design: rebuildCarParameterAggregations iterates runs and
-- reads run.setupSnapshot.data, and rebuildCommunityTemplateAggregations iterates
-- SetupDocuments — neither can see a library row that has no run and no document.

-- Named library setups ("X4 — high grip carpet"); NULL for per-run snapshots.
ALTER TABLE "SetupSnapshot" ADD COLUMN "name" TEXT;
ALTER TABLE "SetupSnapshot" ADD COLUMN "isLibrary" BOOLEAN NOT NULL DEFAULT false;

-- Backs the car-page library list (carId + isLibrary filter).
CREATE INDEX IF NOT EXISTS "SetupSnapshot_carId_isLibrary_idx" ON "SetupSnapshot"("carId", "isLibrary");

-- Manufacturer kit setup for a chassis, same shape as SetupSnapshot.data. Admin-entered.
ALTER TABLE "SetupSheetModel" ADD COLUMN "kitSetupJson" JSONB;
