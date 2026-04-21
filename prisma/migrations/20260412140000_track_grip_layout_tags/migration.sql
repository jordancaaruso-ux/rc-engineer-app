-- Multi-select grip/layout tags replace free-text layout + enum gripLevel.

ALTER TABLE "Track" ADD COLUMN "gripTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Track" ADD COLUMN "layoutTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Track' AND column_name = 'gripLevel'
  ) THEN
    UPDATE "Track" SET "gripTags" = CASE "gripLevel"::text
      WHEN 'LOW' THEN ARRAY['LOW']::TEXT[]
      WHEN 'MEDIUM' THEN ARRAY['MEDIUM']::TEXT[]
      WHEN 'HIGH' THEN ARRAY['HIGH']::TEXT[]
      ELSE ARRAY[]::TEXT[]
    END;
    ALTER TABLE "Track" DROP COLUMN "gripLevel";
  END IF;
END $$;

ALTER TABLE "Track" DROP COLUMN IF EXISTS "layout";

DROP TYPE IF EXISTS "TrackGripLevel";
