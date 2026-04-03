-- CreateTable
CREATE TABLE "Battery" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "packNumber" INTEGER NOT NULL DEFAULT 1,
    "initialRunCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Battery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Battery_userId_idx" ON "Battery"("userId");

-- AddForeignKey
ALTER TABLE "Battery" ADD CONSTRAINT "Battery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "batteryId" TEXT,
ADD COLUMN     "batteryRunNumber" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "Battery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
