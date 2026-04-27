import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Mutual team access: true iff `viewerId` and `targetUserId` are both members
 * of at least one team (pilot contract).
 */
export async function hasTeamAccess(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  const row = await prisma.teamMembership.findFirst({
    where: {
      userId: targetUserId,
      team: { memberships: { some: { userId: viewerId } } },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/** Distinct peer user ids sharing any team with the viewer (excludes viewer). */
export async function listTeamPeerUserIds(viewerId: string): Promise<string[]> {
  const mine = await prisma.teamMembership.findMany({
    where: { userId: viewerId },
    select: { teamId: true },
  });
  const teamIds = mine.map((m) => m.teamId);
  if (teamIds.length === 0) return [];
  const others = await prisma.teamMembership.findMany({
    where: { teamId: { in: teamIds }, userId: { not: viewerId } },
    select: { userId: true },
  });
  return [...new Set(others.map((o) => o.userId))];
}

export type TeamListRow = { id: string; name: string; role: string };

export async function listTeamsForUser(userId: string): Promise<TeamListRow[]> {
  const rows = await prisma.teamMembership.findMany({
    where: { userId },
    select: { role: true, team: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => ({ id: r.team.id, name: r.team.name, role: r.role }));
}

export async function assertTeamAdmin(teamId: string, userId: string): Promise<boolean> {
  const m = await prisma.teamMembership.findFirst({
    where: { teamId, userId, role: "admin" },
    select: { id: true },
  });
  return Boolean(m);
}

export async function assertUserInTeam(teamId: string, userId: string): Promise<boolean> {
  const m = await prisma.teamMembership.findFirst({
    where: { teamId, userId },
    select: { id: true },
  });
  return Boolean(m);
}

/** All member user ids for a team (including every member; caller filters self if needed). */
export async function listTeamMemberUserIds(teamId: string): Promise<string[]> {
  const rows = await prisma.teamMembership.findMany({
    where: { teamId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
