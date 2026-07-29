-- Global, admin-authored baseline setups per chassis type.
-- Replaces the single `SetupSheetModel.kitSetupJson` blob (founder call 2026-07-29: start fresh,
-- kit setups are re-entered as KIT rows).

-- CreateEnum
CREATE TYPE "BaselineSetupKind" AS ENUM ('KIT', 'BASE', 'PRO');

-- CreateTable
CREATE TABLE "BaselineSetup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "setupSheetModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BaselineSetupKind" NOT NULL DEFAULT 'PRO',
    "notes" TEXT,
    "surface" TEXT,
    "gripLevel" TEXT,
    "data" JSONB NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "BaselineSetup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaselineSetup_setupSheetModelId_kind_idx" ON "BaselineSetup"("setupSheetModelId", "kind");

-- AddForeignKey
ALTER TABLE "BaselineSetup" ADD CONSTRAINT "BaselineSetup_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineSetup" ADD CONSTRAINT "BaselineSetup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: lineage from an adopted baseline to the driver's own copy.
ALTER TABLE "SetupSnapshot" ADD COLUMN "sourceBaselineId" TEXT;

-- CreateIndex
CREATE INDEX "SetupSnapshot_sourceBaselineId_idx" ON "SetupSnapshot"("sourceBaselineId");

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_sourceBaselineId_fkey" FOREIGN KEY ("sourceBaselineId") REFERENCES "BaselineSetup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropColumn: the single kit blob is gone; nothing reads it after this release.
ALTER TABLE "SetupSheetModel" DROP COLUMN "kitSetupJson";
