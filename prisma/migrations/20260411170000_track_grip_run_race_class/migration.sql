-- CreateEnum
CREATE TYPE "TrackGripLevel" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "Track" ADD COLUMN "gripLevel" "TrackGripLevel" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "Run" ADD COLUMN "raceClass" TEXT;
