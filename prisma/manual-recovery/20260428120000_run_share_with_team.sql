-- Recovery for P3009 on 20260428120000_run_share_with_team (failed migrate row).
-- Migration adds Run.shareWithTeam. Idempotent.
--
-- 1) Neon SQL Editor: run this file.
-- 2) PC: npx dotenv-cli -e .env.local -- prisma migrate resolve --applied 20260428120000_run_share_with_team
-- 3) npx dotenv-cli -e .env.local -- prisma migrate deploy
-- 4) Redeploy Vercel.

ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "shareWithTeam" BOOLEAN NOT NULL DEFAULT true;
