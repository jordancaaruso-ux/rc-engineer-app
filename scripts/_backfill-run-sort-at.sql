-- One-shot backfill for dev DB after `prisma db push` added Run.sortAt.
-- `db push` does not run the migration file, so existing rows have sortAt = now().
-- This brings them in line with the migration's backfill.
UPDATE "Run"
   SET "sortAt" = COALESCE("sessionCompletedAt", "createdAt");
