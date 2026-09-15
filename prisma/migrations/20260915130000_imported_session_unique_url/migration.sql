-- One imported session per (user, timing URL). The importer always did find-or-create by this
-- pair, but nothing enforced it, so a concurrent sweep tick and a wizard import could each mint a
-- row. Dedupe first: keep the row a run already links to (newest of those), else the newest row;
-- repoint runs whose primary session was a loser, unless the keeper is already some run's primary.
CREATE TEMP TABLE "_dup_imports" AS
SELECT id, keeper
FROM (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "userId", "sourceUrl"
      ORDER BY ("linkedRunId" IS NOT NULL) DESC, "createdAt" DESC, id
    ) AS keeper,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "sourceUrl"
      ORDER BY ("linkedRunId" IS NOT NULL) DESC, "createdAt" DESC, id
    ) AS rn
  FROM "ImportedLapTimeSession"
) ranked
WHERE rn > 1;

UPDATE "Run" r
SET "importedLapTimeSessionId" = d.keeper
FROM "_dup_imports" d
WHERE r."importedLapTimeSessionId" = d.id
  AND NOT EXISTS (SELECT 1 FROM "Run" r2 WHERE r2."importedLapTimeSessionId" = d.keeper);

UPDATE "Run" r
SET "importedLapTimeSessionId" = NULL
FROM "_dup_imports" d
WHERE r."importedLapTimeSessionId" = d.id;

DELETE FROM "ImportedLapTimeSession" WHERE id IN (SELECT id FROM "_dup_imports");

DROP TABLE "_dup_imports";

DROP INDEX IF EXISTS "ImportedLapTimeSession_userId_sourceUrl_idx";
CREATE UNIQUE INDEX "ImportedLapTimeSession_userId_sourceUrl_key"
  ON "ImportedLapTimeSession"("userId", "sourceUrl");
