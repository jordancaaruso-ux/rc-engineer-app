-- Comments on a teammate's run, as seen in that team's delta feed.
--
-- Anchored to (runId, teamId) rather than runId alone: a run appears in the feed of
-- every team its owner belongs to, and those conversations must stay separate — a
-- remark meant for the club group should not surface in the factory squad's feed.
--
-- `parentId` is one level of replies only (threads, not trees). The constraint that a
-- reply's parent is a root comment on the same (runId, teamId) is enforced in
-- application code (`src/lib/teams/commentRules.ts`), not in SQL.
--
-- `deletedAt` is a soft delete by the author (body blanked, row kept so replies keep
-- their anchor). Team admins hard-delete, which cascades to replies.

CREATE TABLE "TeamRunComment" (
  "id"           TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  "teamId"       TEXT NOT NULL,
  "runId"        TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "parentId"     TEXT,
  "body"         TEXT NOT NULL,

  CONSTRAINT "TeamRunComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamRunComment_teamId_runId_createdAt_idx" ON "TeamRunComment"("teamId", "runId", "createdAt");
CREATE INDEX "TeamRunComment_runId_idx" ON "TeamRunComment"("runId");
CREATE INDEX "TeamRunComment_authorUserId_idx" ON "TeamRunComment"("authorUserId");
CREATE INDEX "TeamRunComment_parentId_idx" ON "TeamRunComment"("parentId");

ALTER TABLE "TeamRunComment" ADD CONSTRAINT "TeamRunComment_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRunComment" ADD CONSTRAINT "TeamRunComment_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRunComment" ADD CONSTRAINT "TeamRunComment_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamRunComment" ADD CONSTRAINT "TeamRunComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "TeamRunComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
