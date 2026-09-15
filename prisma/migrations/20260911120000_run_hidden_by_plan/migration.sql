-- Starter tier (docs/STARTER_TIER_PLAN.md): a run the owner's plan cannot see. Null = visible.
-- No backfill: nobody is on Starter until the live price exists, and null is the visible state.

-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "hiddenByPlanAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Run_userId_hiddenByPlanAt_idx" ON "Run"("userId", "hiddenByPlanAt");
