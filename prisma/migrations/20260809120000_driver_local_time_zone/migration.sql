-- Which calendar day a run belongs to is decided in the DRIVER's zone, not the
-- reader's. Keyed on the reader's zone, a teammate's continuous test day splits into
-- two dated groups the moment it crosses the reader's midnight — reported 2026-08-09,
-- one MR33 Arena test day showing as both 06 and 07 Aug in a team Sessions list.
--
-- "Run"."localTimeZone" is stamped from the logging device at create time.
-- "User"."timeZone" is the account-level fallback for runs logged before that existed.
-- Both nullable: existing rows have no zone, and resolveRunLocalTimeZone falls back
-- through owner → viewer exactly as it did before.
ALTER TABLE "Run" ADD COLUMN "localTimeZone" TEXT;
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT;
