-- Which end of the car a catalog tire fits ("front" | "rear" | "all"); only sorts the picker.
-- Additive only.
ALTER TABLE "TireType" ADD COLUMN "position" TEXT;
