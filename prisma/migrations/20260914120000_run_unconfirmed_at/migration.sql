-- Runs the app created from a timing session the driver did not log ("Add N other runs
-- from today"). Null = the driver logged it. Cleared only by a wizard save.
ALTER TABLE "Run" ADD COLUMN "unconfirmedAt" TIMESTAMP(3);

CREATE INDEX "Run_userId_unconfirmedAt_idx" ON "Run"("userId", "unconfirmedAt");
