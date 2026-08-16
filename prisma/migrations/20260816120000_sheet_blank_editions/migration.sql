-- A chassis holds one PRIMARY blank plus any number of rebuilt EDITIONS of the same sheet
-- (same car, same printed layout, every AcroForm box renamed by whoever rebuilt the PDF).
-- Editions carry their own boxes, field list and page images; the model schema stays canonical.

-- 1:1 -> 1:many
DROP INDEX IF EXISTS "SetupSheetBlank_setupSheetModelId_key";

ALTER TABLE "SetupSheetBlank" ADD COLUMN "isEdition" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SetupSheetBlank" ADD COLUMN "schemaFieldsJson" JSONB;
ALTER TABLE "SetupSheetBlank" ADD COLUMN "fingerprint" TEXT;

CREATE INDEX "SetupSheetBlank_setupSheetModelId_isEdition_idx"
  ON "SetupSheetBlank"("setupSheetModelId", "isEdition");
