-- Make SetupSheetModel global (shared across users) instead of per-user.
-- Non-destructive: no rows or columns are dropped. The global UNIQUE(slug) is added in a
-- LATER migration, after scripts/dedupe-setup-sheet-models.ts collapses per-user duplicates.

-- AlterTable: add authorized flag (curated catalog entries) and relax creator ownership.
ALTER TABLE "SetupSheetModel" ADD COLUMN "isAuthorized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SetupSheetModel" ALTER COLUMN "userId" DROP NOT NULL;

-- Drop the per-user uniqueness so the same chassis can be shared globally.
ALTER TABLE "SetupSheetModel" DROP CONSTRAINT IF EXISTS "SetupSheetModel_userId_slug_key";
DROP INDEX IF EXISTS "SetupSheetModel_userId_slug_key";

-- Keep creator as attribution only: deleting a user nulls the creator instead of cascade-deleting
-- a now-shared model.
ALTER TABLE "SetupSheetModel" DROP CONSTRAINT IF EXISTS "SetupSheetModel_userId_fkey";
ALTER TABLE "SetupSheetModel" ADD CONSTRAINT "SetupSheetModel_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for global slug lookups (non-unique until dedupe runs).
CREATE INDEX IF NOT EXISTS "SetupSheetModel_slug_idx" ON "SetupSheetModel"("slug");
