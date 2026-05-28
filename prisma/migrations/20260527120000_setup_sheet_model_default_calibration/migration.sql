-- AlterTable
ALTER TABLE "SetupSheetModel" ADD COLUMN "defaultCalibrationId" TEXT;

-- AddForeignKey
ALTER TABLE "SetupSheetModel" ADD CONSTRAINT "SetupSheetModel_defaultCalibrationId_fkey" FOREIGN KEY ("defaultCalibrationId") REFERENCES "SetupSheetCalibration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
