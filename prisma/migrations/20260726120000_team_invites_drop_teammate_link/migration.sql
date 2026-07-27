-- Consent gate for teams, and removal of the unilateral TeammateLink grant.
--
-- Before this migration, POST /api/teams/[teamId]/members created a TeamMembership row directly:
-- an admin typing your email gained mutual, retroactive access to your entire run history with no
-- accept step and no notification. TeamInvite is the missing consent object.
--
-- TeamInvite is deliberately a separate table rather than a `status` column on TeamMembership, so
-- that no membership row exists until the invited user accepts. Every existing query that reads
-- TeamMembership therefore stays correct without modification.
--
-- DESTRUCTIVE: TeammateLink is dropped. It was a one-way grant any authenticated user could create
-- against any email, and it bypassed Run."shareWithTeam". Viewers holding a link lose that access
-- when this runs. Record `SELECT count(*) FROM "TeammateLink"` before applying so the blast radius
-- is known. Existing TeamMembership rows are left untouched and treated as already consented.

CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "invitedUserId" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- One row per (team, user) for all time; a re-invite after a decline resets that row to 'pending'.
CREATE UNIQUE INDEX "TeamInvite_teamId_invitedUserId_key" ON "TeamInvite"("teamId", "invitedUserId");

-- Backs the invitee's pending-invite list (/teams card + dashboard card).
CREATE INDEX "TeamInvite_invitedUserId_status_idx" ON "TeamInvite"("invitedUserId", "status");

-- Backs the admin's "invited — awaiting response" list on the team detail panel.
CREATE INDEX "TeamInvite_teamId_status_idx" ON "TeamInvite"("teamId", "status");

ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedUserId_fkey"
    FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: an invite outlives the admin who sent it, the same way Team.createdByUserId does.
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "TeammateLink";
