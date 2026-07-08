-- Soft delete for reusable assets: hide worn-out tire sets / dead battery packs
-- without breaking the run history that references them.

-- AlterTable
ALTER TABLE "TireSet" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Battery" ADD COLUMN "archivedAt" TIMESTAMP(3);
