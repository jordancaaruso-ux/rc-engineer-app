-- CreateEnum
CREATE TYPE "ActionItemListKind" AS ENUM ('THINGS_TO_TRY', 'THINGS_TO_DO');

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "listKind" "ActionItemListKind" NOT NULL DEFAULT 'THINGS_TO_TRY',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill sortOrder: preserve prior GET order (newest first) as sortOrder 0,1,2,...
UPDATE "ActionItem" AS a
SET "sortOrder" = s.ord
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) - 1 AS ord
  FROM "ActionItem"
) AS s
WHERE a.id = s.id;

-- DropIndex
DROP INDEX IF EXISTS "ActionItem_userId_isArchived_createdAt_idx";
DROP INDEX IF EXISTS "ActionItem_userId_normKey_isArchived_idx";

-- CreateIndex
CREATE INDEX "ActionItem_userId_listKind_isArchived_sortOrder_idx" ON "ActionItem"("userId", "listKind", "isArchived", "sortOrder");
CREATE INDEX "ActionItem_userId_isArchived_createdAt_idx" ON "ActionItem"("userId", "isArchived", "createdAt");
CREATE INDEX "ActionItem_userId_listKind_normKey_isArchived_idx" ON "ActionItem"("userId", "listKind", "normKey", "isArchived");

-- AlterTable Run
ALTER TABLE "Run" ADD COLUMN "suggestedPreRun" TEXT;
