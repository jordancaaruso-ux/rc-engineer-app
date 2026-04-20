-- Adds Run.sortAt as the stable ordering axis for run history / lists.
-- Stamped once at create (server now()) and never auto-updated; only mutated by
-- explicit user reorder. Backfilled from `COALESCE(sessionCompletedAt, createdAt)`
-- so existing runs keep approximately today's visible order after the switch.

-- 1. Add the column nullable first so we can backfill deterministically from
--    existing per-row values, then tighten to NOT NULL with a default for new rows.
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "sortAt" TIMESTAMP(3);

UPDATE "Run"
   SET "sortAt" = COALESCE("sessionCompletedAt", "createdAt")
 WHERE "sortAt" IS NULL;

ALTER TABLE "Run" ALTER COLUMN "sortAt" SET NOT NULL;
ALTER TABLE "Run" ALTER COLUMN "sortAt" SET DEFAULT now();

CREATE INDEX IF NOT EXISTS "Run_userId_sortAt_idx" ON "Run" ("userId", "sortAt");
