-- Asset Access North Star Phase 1: founder-verified flag on global catalog rows.
-- Null = unverified (user-created, live but flagged; excluded from community aggregations
-- and, for calibrations, from cross-user auto-pick). See docs/ASSET_ACCESS_NORTH_STAR.md.

ALTER TABLE "TireType" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "AdditiveType" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Track" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "SetupSheetCalibration" ADD COLUMN "verifiedAt" TIMESTAMP(3);
