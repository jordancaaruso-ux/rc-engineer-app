-- Optional controlled / spec tire compound for an event (matches TireSet.label style).
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "controlledTireLabel" TEXT;
