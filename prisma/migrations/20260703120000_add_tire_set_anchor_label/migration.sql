-- Add human anchor label to TireSet: the session a set was first run in (e.g. "A1"),
-- captured on first completed run and never auto-changed. Nullable; legacy/unrun sets stay NULL.
ALTER TABLE "TireSet" ADD COLUMN "anchorLabel" TEXT;
