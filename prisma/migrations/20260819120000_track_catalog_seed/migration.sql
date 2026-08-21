-- Pre-seeded track catalog: country/region for scoped browsing, and a source identity that makes
-- the seed importer idempotent. See seeds/track-catalog/README.md.
--
-- Deliberately NOT in this migration: the case-insensitive unique on "Track"."name". It is still
-- deferred (docs/ASSET_ACCESS_NORTH_STAR.md) and would fail against existing production duplicates.

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "catalogSource" TEXT,
ADD COLUMN     "catalogSourceRef" TEXT;

-- CreateIndex
-- Postgres treats NULLs as distinct, so every user-created track (both columns null) coexists
-- freely; the constraint only binds rows that actually claim a catalog identity.
CREATE UNIQUE INDEX "Track_catalogSource_catalogSourceRef_key" ON "Track"("catalogSource", "catalogSourceRef");

-- CreateIndex
CREATE INDEX "Track_countryCode_name_idx" ON "Track"("countryCode", "name");
