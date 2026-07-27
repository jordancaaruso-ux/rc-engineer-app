-- Enrich "TireType" with catalog attributes for AI pre-seed (touring TC first — see ASSET_ACCESS_NORTH_STAR.md).
-- Additive + all-nullable → safe under `prisma migrate deploy`, no backfill. Existing rows unaffected;
-- nothing in a request path reads these until the review/import + picker filter land (deliberate later steps).

ALTER TABLE "TireType" ADD COLUMN "discipline" TEXT;
ALTER TABLE "TireType" ADD COLUMN "brand" TEXT;
ALTER TABLE "TireType" ADD COLUMN "model" TEXT;
ALTER TABLE "TireType" ADD COLUMN "compound" TEXT;
ALTER TABLE "TireType" ADD COLUMN "surface" TEXT;
ALTER TABLE "TireType" ADD COLUMN "tireType" TEXT;
ALTER TABLE "TireType" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "TireType" ADD COLUMN "productUrl" TEXT;

CREATE INDEX "TireType_discipline_idx" ON "TireType"("discipline");
