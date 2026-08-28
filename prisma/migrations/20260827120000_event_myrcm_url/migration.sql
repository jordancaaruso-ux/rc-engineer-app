-- An event says where it lives on MyRCM.
--
-- MyRCM results cannot be fetched (myrcm.ch went on the timing denylist 2026-08-26); the driver
-- downloads the PDF from MyRCM themselves and uploads it. That trip starts with a link, and until
-- now there was nowhere to keep one, so the importer could only offer MyRCM's front page and leave
-- the driver to find their own meeting on a phone at the track.
--
-- Stored separately from `resultsSourceUrl` on purpose: that column means "an index we scan", and
-- every reader of it issues a fetch. This one is a destination only — nothing in the app may
-- request it.
--
-- Nullable, no default and no backfill: only a driver can say which class on MyRCM is theirs.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "myRcmUrl" TEXT;
