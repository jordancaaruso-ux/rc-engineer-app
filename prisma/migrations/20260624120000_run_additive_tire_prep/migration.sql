-- CreateTable
CREATE TABLE "AdditiveType" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "AdditiveType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Run" ADD COLUMN "additiveTypeId" TEXT,
ADD COLUMN "warmerTimingMinutes" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "AdditiveType_modelCode_key" ON "AdditiveType"("modelCode");

-- CreateIndex
CREATE INDEX "AdditiveType_displayName_idx" ON "AdditiveType"("displayName");

-- AddForeignKey
ALTER TABLE "AdditiveType" ADD CONSTRAINT "AdditiveType_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_additiveTypeId_fkey" FOREIGN KEY ("additiveTypeId") REFERENCES "AdditiveType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
