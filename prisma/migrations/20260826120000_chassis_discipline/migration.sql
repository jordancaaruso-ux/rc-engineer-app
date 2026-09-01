-- A chassis says what it races.
--
-- Discipline used to be inferred from CHASSIS_PLATFORM_BY_SLUG (src/lib/cars/chassisPlatform.ts),
-- a hardcoded map of twelve curated slugs, all of them "touring". A chassis a driver derived from
-- their own PDF matched nothing in it, so its discipline was null forever unless the driver went
-- to the car page afterwards and set Car.carClass by hand. The create-from-PDF door now asks.
--
-- Nullable and undefaulted on purpose: existing rows are answered by the slug map, and picking a
-- default would stamp every one of them with a discipline nobody chose. Backfilling is a separate
-- decision, not something a schema migration should assume.

-- AlterTable
ALTER TABLE "SetupSheetModel" ADD COLUMN     "discipline" TEXT;
