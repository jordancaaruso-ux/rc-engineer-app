-- Collapse any remaining duplicate-slug SetupSheetModel rows, then enforce global slug uniqueness.
-- Keeper election matches the app's canonical ordering everywhere models are picked among
-- duplicates: isAuthorized DESC, createdAt ASC. Safe to run on an already-clean database (no-ops).

-- 1) Elect one keeper per slug.
CREATE TEMPORARY TABLE "_ssm_slug_keepers" AS
SELECT DISTINCT ON ("slug") "id" AS "keeperId", "slug"
FROM "SetupSheetModel"
ORDER BY "slug", "isAuthorized" DESC, "createdAt" ASC;

-- 2) Repoint references from losers onto the keeper.
UPDATE "Car" c
SET "setupSheetModelId" = k."keeperId"
FROM "SetupSheetModel" m
JOIN "_ssm_slug_keepers" k ON k."slug" = m."slug"
WHERE c."setupSheetModelId" = m."id" AND m."id" <> k."keeperId";

UPDATE "SetupSheetCalibration" cal
SET "setupSheetModelId" = k."keeperId"
FROM "SetupSheetModel" m
JOIN "_ssm_slug_keepers" k ON k."slug" = m."slug"
WHERE cal."setupSheetModelId" = m."id" AND m."id" <> k."keeperId";

UPDATE "SetupDocument" d
SET "setupSheetModelId" = k."keeperId"
FROM "SetupSheetModel" m
JOIN "_ssm_slug_keepers" k ON k."slug" = m."slug"
WHERE d."setupSheetModelId" = m."id" AND m."id" <> k."keeperId";

-- 3) Adopt a loser's default calibration when the keeper has none.
UPDATE "SetupSheetModel" w
SET "defaultCalibrationId" = l."defaultCalibrationId"
FROM "_ssm_slug_keepers" k
JOIN "SetupSheetModel" l
  ON l."slug" = k."slug" AND l."id" <> k."keeperId" AND l."defaultCalibrationId" IS NOT NULL
WHERE w."id" = k."keeperId"
  AND w."defaultCalibrationId" IS NULL;

-- 4) Release losers' unique defaultCalibrationId, then delete the losers.
UPDATE "SetupSheetModel" m
SET "defaultCalibrationId" = NULL
FROM "_ssm_slug_keepers" k
WHERE m."slug" = k."slug" AND m."id" <> k."keeperId";

DELETE FROM "SetupSheetModel" m
USING "_ssm_slug_keepers" k
WHERE m."slug" = k."slug" AND m."id" <> k."keeperId";

DROP TABLE "_ssm_slug_keepers";

-- 5) Enforce uniqueness (replaces the plain slug index).
DROP INDEX IF EXISTS "SetupSheetModel_slug_idx";
CREATE UNIQUE INDEX "SetupSheetModel_slug_key" ON "SetupSheetModel"("slug");
