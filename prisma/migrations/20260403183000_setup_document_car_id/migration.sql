-- AlterTable
ALTER TABLE "SetupDocument" ADD COLUMN "carId" TEXT;

-- CreateIndex
CREATE INDEX "SetupDocument_carId_idx" ON "SetupDocument"("carId");

-- AddForeignKey
ALTER TABLE "SetupDocument" ADD CONSTRAINT "SetupDocument_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;
