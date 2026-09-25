-- A driver's own names for boxes on their car's sheet that the app cannot read yet, typed under an
-- Engineer answer's setup-change link. Saved to the car only (founder, 2026-09-25: "their car at
-- once, offered to the chassis after his OK"). Additive only.
ALTER TABLE "Car" ADD COLUMN "sheetBoxNamesJson" JSONB;
