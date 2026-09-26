import "server-only";

import { prisma } from "@/lib/prisma";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";

/** A team invite addressed to the viewer — their inbox, not an admin's view of a team. */
export type PendingInviteForViewer = {
  id: string;
  teamId: string;
  teamName: string;
  invitedByLabel: string | null;
  createdAt: string;
};

/**
 * The viewer's own pending team invites, newest first.
 *
 * One loader for both places an invite surfaces: the `/teams` page, where it is answered, and
 * `GET /api/teams/invites`, which feeds the dashboard card that sends the driver there. Two copies
 * of this query are how the card could say "invite waiting" while the page showed nothing.
 *
 * "From" names the admin the way their team does (`loadTeamMemberDisplays`), so an admin who set
 * a name is not introduced by their email.
 */
export async function listPendingInvitesForUser(userId: string): Promise<PendingInviteForViewer[]> {
  const invites = await prisma.teamInvite.findMany({
    where: { invitedUserId: userId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      invitedByUserId: true,
      team: { select: { id: true, name: true } },
    },
  });
  if (invites.length === 0) return [];

  const inviterIds = [
    ...new Set(invites.map((i) => i.invitedByUserId).filter((id): id is string => !!id)),
  ];
  const inviters = await loadTeamMemberDisplays(inviterIds, userId);

  return invites.map((i) => ({
    id: i.id,
    teamId: i.team.id,
    teamName: i.team.name,
    invitedByLabel: (i.invitedByUserId && inviters.get(i.invitedByUserId)?.name) || null,
    createdAt: i.createdAt.toISOString(),
  }));
}
