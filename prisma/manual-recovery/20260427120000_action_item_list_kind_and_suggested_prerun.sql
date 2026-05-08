-- Completes migration 20260427120000_action_item_list_kind_and_suggested_prerun when the
-- enum ActionItemListKind already exists (42710) but later steps may not have run.
-- Run in Neon, then: npx prisma migrate resolve --applied 20260427120000_action_item_list_kind_and_suggested_prerun

ALTER TABLE "ActionItem"
  ADD COLUMN IF NOT EXISTS "listKind" "ActionItemListKind" NOT NULL DEFAULT 'THINGS_TO_TRY',
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ActionItem" AS a
SET "sortOrder" = s.ord
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) - 1 AS ord
  FROM "ActionItem"
) AS s
WHERE a.id = s.id;

DROP INDEX IF EXISTS "ActionItem_userId_isArchived_createdAt_idx";
DROP INDEX IF EXISTS "ActionItem_userId_normKey_isArchived_idx";

CREATE INDEX IF NOT EXISTS "ActionItem_userId_listKind_isArchived_sortOrder_idx"
  ON "ActionItem"("userId", "listKind", "isArchived", "sortOrder");
CREATE INDEX IF NOT EXISTS "ActionItem_userId_isArchived_createdAt_idx"
  ON "ActionItem"("userId", "isArchived", "createdAt");
CREATE INDEX IF NOT EXISTS "ActionItem_userId_listKind_normKey_isArchived_idx"
  ON "ActionItem"("userId", "listKind", "normKey", "isArchived");

ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "suggestedPreRun" TEXT;
