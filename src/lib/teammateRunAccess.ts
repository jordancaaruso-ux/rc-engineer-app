import { prisma } from "@/lib/prisma";
import { hasTeamAccess } from "@/lib/teamAccess";

export async function hasTeammateLink(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  const row = await prisma.teammateLink.findFirst({
    where: { userId: viewerId, peerUserId: targetUserId },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * True when the viewer may see this owner's runs only via mutual team (no one-way TeammateLink).
 * Used to apply `Run.shareWithTeam` without affecting linked-teammate flows.
 */
export async function peerAccessIsTeamOnly(viewerId: string, ownerUserId: string): Promise<boolean> {
  if (viewerId === ownerUserId) return false;
  if (await hasTeammateLink(viewerId, ownerUserId)) return false;
  return hasTeamAccess(viewerId, ownerUserId);
}

/** Treat null/legacy as shared. */
export function isRunSharedWithTeam(run: { shareWithTeam?: boolean | null }): boolean {
  return run.shareWithTeam !== false;
}

/** Teammate link OR mutual team membership (Engineer / team Sessions pilot). */
export async function canViewPeerRuns(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  if (await hasTeammateLink(viewerId, targetUserId)) return true;
  return hasTeamAccess(viewerId, targetUserId);
}
