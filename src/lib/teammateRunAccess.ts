import { hasTeamAccess } from "@/lib/teamAccess";

/**
 * Mutual team membership is the only route to another user's runs.
 *
 * There used to be a second route — a one-way `TeammateLink` that any authenticated user could
 * create against any email, which also bypassed `Run.shareWithTeam`. It was removed (see the
 * `team_invites_drop_teammate_link` migration) because it granted access without the owner's
 * consent. These helpers keep their original names and signatures so every caller is unchanged;
 * the effect of the removal is that `shareWithTeam` is now honoured on every peer surface.
 */

/**
 * True when the viewer may see this owner's runs *only* through team membership — which, now that
 * links are gone, is true of any peer. Callers use it to decide whether to apply `shareWithTeam`.
 */
export async function peerAccessIsTeamOnly(viewerId: string, ownerUserId: string): Promise<boolean> {
  if (viewerId === ownerUserId) return false;
  return hasTeamAccess(viewerId, ownerUserId);
}

/** Treat null/legacy as shared. */
export function isRunSharedWithTeam(run: { shareWithTeam?: boolean | null }): boolean {
  return run.shareWithTeam !== false;
}

/** Whether the viewer may read this peer's runs at all (Engineer compare / team Sessions). */
export async function canViewPeerRuns(viewerId: string, targetUserId: string): Promise<boolean> {
  if (viewerId === targetUserId) return true;
  return hasTeamAccess(viewerId, targetUserId);
}
