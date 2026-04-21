-- Optional list-row title for dashboard prompts (e.g. LiveRC race link text)
ALTER TABLE "ImportedLapTimeSession" ADD COLUMN IF NOT EXISTS "eventDetectionSessionLabel" TEXT;
