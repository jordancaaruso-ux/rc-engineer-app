-- Practice day URL per run: lets the Lap Times "url" picker remember which
-- day's results page to scan for this session without relying solely on the
-- user-wide `currentPracticeDayUrl` setting (which moves on with the user).
ALTER TABLE "Run" ADD COLUMN "practiceDayUrl" TEXT;
