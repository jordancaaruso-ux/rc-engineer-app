import "server-only";

import { prisma } from "@/lib/prisma";
import { canViewPeerRuns, isRunSharedWithTeam, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";
import { evaluateQuickFixAccess } from "@/lib/engineerPhase5/quickFix/quickFixAccess";
import { isRunEligibleForEngineerArtifacts } from "@/lib/engineerPhase5/runEligibility";

export type QuickFixRunRow = {
  id: string;
  userId: string;
  shareWithTeam: boolean | null;
  carId: string | null;
  carRating: number | null;
  loggingComplete: boolean;
  loggingCompletedAt: Date | null;
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  handlingAssessmentJson: unknown;
  suggestedChanges: string | null;
  appliedChanges: string | null;
  setupSnapshot: { id: string; data: unknown } | null;
  car: { id: string; name: string } | null;
  track: { id: string; name: string } | null;
  event: { id: string; name: string } | null;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  trackId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
};

const quickFixRunSelect = {
  id: true,
  userId: true,
  shareWithTeam: true,
  carId: true,
  carRating: true,
  loggingComplete: true,
  loggingCompletedAt: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  handlingAssessmentJson: true,
  suggestedChanges: true,
  appliedChanges: true,
  setupSnapshot: { select: { id: true, data: true } },
  car: { select: { id: true, name: true } },
  track: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  createdAt: true,
  sessionCompletedAt: true,
  trackId: true,
  tireSetId: true,
  tireRunNumber: true,
} as const;

export async function viewerMayAccessQuickFixRun(
  viewerId: string,
  run: { userId: string; shareWithTeam: boolean | null }
): Promise<boolean> {
  if (run.userId === viewerId) return true;
  const canViewPeer = await canViewPeerRuns(viewerId, run.userId);
  const teamOnly = await peerAccessIsTeamOnly(viewerId, run.userId);
  return evaluateQuickFixAccess({
    viewerId,
    runUserId: run.userId,
    shareWithTeam: run.shareWithTeam,
    canViewPeer,
    teamOnly,
  });
}

export async function loadQuickFixRunForViewer(
  viewerId: string,
  runId: string
): Promise<{ run: QuickFixRunRow; contextUserId: string } | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId.trim() },
    select: quickFixRunSelect,
  });
  if (!run) return null;
  if (!(await viewerMayAccessQuickFixRun(viewerId, run))) return null;
  if (!isRunEligibleForEngineerArtifacts(run)) return null;
  return { run, contextUserId: run.userId };
}

export function quickFixRunLabel(run: QuickFixRunRow): string {
  const parts = [run.car?.name ?? "Car"];
  if (run.track?.name) parts.push(run.track.name);
  if (run.event?.name) parts.push(run.event.name);
  return parts.join(" · ");
}
