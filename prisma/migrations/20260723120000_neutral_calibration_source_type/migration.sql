-- Rebrand calibration source-type tags to brand-neutral values.
-- Historically PDF calibrations were tagged "awesomatix_pdf" and image
-- calibrations "awesomatix_image_v1"; nothing branches on the value, it is
-- display-only metadata. New rows are written as "pdf" / "image".
UPDATE "SetupSheetCalibration" SET "sourceType" = 'pdf' WHERE "sourceType" = 'awesomatix_pdf';
UPDATE "SetupSheetCalibration" SET "sourceType" = 'image' WHERE "sourceType" = 'awesomatix_image_v1';
