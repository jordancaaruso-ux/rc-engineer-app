import "server-only";

import { prisma } from "@/lib/prisma";
import { blockedPeersFromRows } from "@/lib/moderation/visibilityRules";

/**
 * Block (App Store guideline 1.2, 2026-09-26). Once either driver blocks the other, neither sees
 * the other's runs or comments, neither gets the other's comment pushes, and neither can invite
 * the other to a team. Only the blocker can lift it.
 *
 * Every team surface already asks `hasTeamAccess` / `listTeamPeerUserIds` (`teamAccess.ts`), so
 * the block is applied there once; the team feed and the comment list, which read memberships
 * directly, ask `loadBlockedPeerIds` themselves.
 */

/** Every driver in a block with the viewer, whichever side made it. */
export async function loadBlockedPeerIds(viewerId: string): Promise<Set<string>> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerUserId: viewerId }, { blockedUserId: viewerId }] },
    select: { blockerUserId: true, blockedUserId: true },
  });
  return blockedPeersFromRows(viewerId, rows);
}

/** Is there a block between these two drivers, either way? */
export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerUserId: a, blockedUserId: b },
        { blockerUserId: b, blockedUserId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

/** The drivers this viewer blocked themselves: the ones they can unblock. */
export async function loadBlocksMadeBy(viewerId: string): Promise<Set<string>> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerUserId: viewerId },
    select: { blockedUserId: true },
  });
  return new Set(rows.map((r) => r.blockedUserId));
}

/**
 * Do these two drivers share a team, or is an invite between them waiting? Blocking needs one of
 * the two, so an account id picked out of nowhere can't be blocked or probed. Deliberately
 * ignores blocks: a driver already blocked must still be reachable to report.
 */
export async function driversAreConnected(viewerId: string, otherUserId: string): Promise<boolean> {
  if (viewerId === otherUserId) return false;
  const [sharedTeam, invite] = await Promise.all([
    prisma.teamMembership.findFirst({
      where: { userId: otherUserId, team: { memberships: { some: { userId: viewerId } } } },
      select: { id: true },
    }),
    prisma.teamInvite.findFirst({
      where: {
        status: "pending",
        OR: [
          { invitedUserId: viewerId, invitedByUserId: otherUserId },
          { invitedUserId: otherUserId, invitedByUserId: viewerId },
        ],
      },
      select: { id: true },
    }),
  ]);
  return Boolean(sharedTeam || invite);
}

/**
 * Block, and withdraw any invite waiting between the two either way: an invite from someone you
 * just blocked must not sit on your Teams page.
 */
export async function blockDriver(blockerUserId: string, blockedUserId: string): Promise<void> {
  await prisma.$transaction([
    prisma.userBlock.upsert({
      where: { blockerUserId_blockedUserId: { blockerUserId, blockedUserId } },
      create: { blockerUserId, blockedUserId },
      update: {},
      select: { id: true },
    }),
    prisma.teamInvite.updateMany({
      where: {
        status: "pending",
        OR: [
          { invitedUserId: blockerUserId, invitedByUserId: blockedUserId },
          { invitedUserId: blockedUserId, invitedByUserId: blockerUserId },
        ],
      },
      data: { status: "revoked", respondedAt: new Date() },
    }),
  ]);
}

export async function unblockDriver(blockerUserId: string, blockedUserId: string): Promise<void> {
  await prisma.userBlock.deleteMany({ where: { blockerUserId, blockedUserId } });
}
