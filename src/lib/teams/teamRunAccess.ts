import "server-only";
import { canViewPeerRuns, isRunSharedWithTeam, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";

/**
 * May this viewer see this run at all?
 *
 * Own runs always. A peer's run only when a link or a mutual team grants access, and —
 * when the only route in is the team — only if the owner left `shareWithTeam` on.
 *
 * Lifted from `src/app/api/runs/[id]/setup-snapshot/route.ts`, which had it inline. Team
 * comment routes need exactly the same check: you must not be able to comment on, or read
 * comments about, a run you cannot see.
 */
export async function viewerMayAccessRun(
  viewerId: string,
  run: { userId: string; shareWithTeam: boolean | null }
): Promise<boolean> {
  if (run.userId === viewerId) return true;
  if (!(await canViewPeerRuns(viewerId, run.userId))) return false;
  if (await peerAccessIsTeamOnly(viewerId, run.userId)) {
    return isRunSharedWithTeam(run);
  }
  return true;
}
