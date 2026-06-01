-- AlterTable
ALTER TABLE "Track" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "locationMarkedAt" TIMESTAMP(3),
ADD COLUMN "locationSource" TEXT;
