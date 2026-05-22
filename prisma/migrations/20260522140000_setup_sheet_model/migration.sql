-- CreateTable
CREATE TABLE "SetupSheetModel" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SetupSheetModel_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Car" ADD COLUMN "setupSheetModelId" TEXT;

-- AlterTable
ALTER TABLE "SetupDocument" ADD COLUMN "setupSheetModelId" TEXT;

-- AlterTable
ALTER TABLE "SetupSheetCalibration" ADD COLUMN "setupSheetModelId" TEXT;

-- CreateIndex
CREATE INDEX "SetupSheetModel_userId_updatedAt_idx" ON "SetupSheetModel"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SetupSheetModel_userId_slug_key" ON "SetupSheetModel"("userId", "slug");

-- CreateIndex
CREATE INDEX "Car_setupSheetModelId_idx" ON "Car"("setupSheetModelId");

-- CreateIndex
CREATE INDEX "SetupDocument_userId_setupSheetModelId_idx" ON "SetupDocument"("userId", "setupSheetModelId");

-- CreateIndex
CREATE INDEX "SetupDocument_setupSheetModelId_idx" ON "SetupDocument"("setupSheetModelId");

-- CreateIndex
CREATE INDEX "SetupSheetCalibration_userId_setupSheetModelId_idx" ON "SetupSheetCalibration"("userId", "setupSheetModelId");

-- CreateIndex
CREATE INDEX "SetupSheetCalibration_setupSheetModelId_idx" ON "SetupSheetCalibration"("setupSheetModelId");

-- AddForeignKey
ALTER TABLE "SetupSheetModel" ADD CONSTRAINT "SetupSheetModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Car" ADD CONSTRAINT "Car_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupSheetCalibration" ADD CONSTRAINT "SetupSheetCalibration_setupSheetModelId_fkey" FOREIGN KEY ("setupSheetModelId") REFERENCES "SetupSheetModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
