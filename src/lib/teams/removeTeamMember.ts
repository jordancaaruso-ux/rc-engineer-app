import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Take one driver out of a team: leaving, an admin's Remove, or the founder removing a reported
 * driver from the review queue. The last admin going promotes the earliest-joined other member,
 * and a team left empty is deleted.
 */
export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const membership = await prisma.teamMembership.findFirst({
    where: { teamId, userId },
    select: { id: true, role: true },
  });
  if (!membership) return false;

  await prisma.$transaction(async (tx) => {
    if (membership.role === "admin") {
      const adminCount = await tx.teamMembership.count({
        where: { teamId, role: "admin" },
      });
      if (adminCount === 1) {
        const next = await tx.teamMembership.findFirst({
          where: { teamId, userId: { not: userId } },
          orderBy: { joinedAt: "asc" },
          select: { userId: true },
        });
        if (next) {
          await tx.teamMembership.update({
            where: { teamId_userId: { teamId, userId: next.userId } },
            data: { role: "admin" },
          });
        }
      }
    }

    await tx.teamMembership.delete({
      where: { teamId_userId: { teamId, userId } },
    });

    const remaining = await tx.teamMembership.count({ where: { teamId } });
    if (remaining === 0) {
      await tx.team.delete({ where: { id: teamId } });
    }
  });
  return true;
}
