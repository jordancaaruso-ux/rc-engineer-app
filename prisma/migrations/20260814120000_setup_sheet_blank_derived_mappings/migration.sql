-- Mappings for the printed boxes a CALIBRATION does not name, so a curated chassis draws, imports
-- and exports every box on its sheet rather than only the ones a human named.
--
-- Kept apart from `SetupSheetCalibration.calibrationDataJson.formFieldMappings` on purpose: values
-- read through that map go through the Awesomatix canonical-key rewrites, and a derived key such as
-- `text91` is hard-coded there onto a spring-rate key. These are read with `readDerivedSheetValues`.
ALTER TABLE "SetupSheetBlank" ADD COLUMN "derivedMappingsJson" JSONB;
