-- CreateTable
CREATE TABLE "TireType" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "TireType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "controlledTireTypeId" TEXT;

-- AlterTable
ALTER TABLE "TireSet" ADD COLUMN "insertLabel" TEXT,
ADD COLUMN "wheelLabel" TEXT,
ADD COLUMN "tireTypeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TireType_modelCode_key" ON "TireType"("modelCode");

-- CreateIndex
CREATE INDEX "TireType_displayName_idx" ON "TireType"("displayName");

-- CreateIndex
CREATE INDEX "TireSet_userId_tireTypeId_setNumber_idx" ON "TireSet"("userId", "tireTypeId", "setNumber");

-- AddForeignKey
ALTER TABLE "TireType" ADD CONSTRAINT "TireType_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_controlledTireTypeId_fkey" FOREIGN KEY ("controlledTireTypeId") REFERENCES "TireType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_tireTypeId_fkey" FOREIGN KEY ("tireTypeId") REFERENCES "TireType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
