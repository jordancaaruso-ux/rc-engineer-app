import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canViewPeerRuns, isRunSharedWithTeam, peerAccessIsTeamOnly } from "@/lib/teammateRunAccess";

type Params = { params: Promise<{ id: string }> };

async function viewerMayAccessRun(
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

/** Lazy-load setup snapshot data for sessions list / modal (avoids shipping full JSON in SSR). */
export async function GET(_request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id },
    select: {
      id: true,
      userId: true,
      shareWithTeam: true,
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await viewerMayAccessRun(user.id, run))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    runId: run.id,
    setupSnapshot: run.setupSnapshot,
  });
}
