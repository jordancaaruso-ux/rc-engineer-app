import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { assertTeamAdmin, assertUserInTeam } from "@/lib/teamAccess";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";
import { loadCommentsForRuns } from "@/lib/teams/loadTeamFeed";
import { listTeamMemberUserIds } from "@/lib/teamAccess";
import { resolveReplyParentId, validateCommentBody } from "@/lib/teams/commentRules";
import { notifyTeamComment } from "@/lib/teams/notifyTeamComment";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string }> };

/**
 * Both handlers gate on three things, in order: the viewer is in this team, the run is
 * visible to them, and the run's owner is in the team too. The last one stops a comment
 * being attached to a run that reached the viewer through a one-way teammate link rather
 * than through this team.
 */
async function resolveCommentTarget(teamId: string, runId: string, viewerId: string) {
  if (!(await assertUserInTeam(teamId, viewerId))) return { error: "Not found" as const };

  const run = await prisma.run.findFirst({
    where: { id: runId },
    select: { id: true, userId: true, shareWithTeam: true },
  });
  if (!run) return { error: "Not found" as const };
  if (!(await viewerMayAccessRun(viewerId, run))) return { error: "Not found" as const };

  const memberIds = await listTeamMemberUserIds(teamId);
  if (!memberIds.includes(run.userId)) return { error: "Not found" as const };

  return { run, memberIds };
}

/** Comments on one run in this team. `?runId=` is required — there is no team-wide thread. */
export async function GET(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await ctx.params;
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const target = await resolveCommentTarget(teamId, runId, userId);
  if ("error" in target) return NextResponse.json({ error: target.error }, { status: 404 });

  const viewerIsAdmin = await assertTeamAdmin(teamId, userId);
  const displays = await loadTeamMemberDisplays(target.memberIds, userId);
  const byRunId = await loadCommentsForRuns({
    teamId,
    runIds: [runId],
    viewerId: userId,
    viewerIsAdmin,
    displays,
  });

  return NextResponse.json({ comments: byRunId.get(runId) ?? [] });
}

/** Post a comment, or a reply when `parentId` is given. */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    runId?: string;
    body?: unknown;
    parentId?: string | null;
  } | null;

  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  const validated = validateCommentBody(body?.body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const target = await resolveCommentTarget(teamId, runId, userId);
  if ("error" in target) return NextResponse.json({ error: target.error }, { status: 404 });

  const parent = body?.parentId
    ? await prisma.teamRunComment.findFirst({
        where: { id: body.parentId },
        select: { id: true, teamId: true, runId: true, parentId: true },
      })
    : null;
  if (body?.parentId && !parent) {
    return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
  }

  const resolvedParent = resolveReplyParentId(parent, { teamId, runId });
  if (!resolvedParent.ok) {
    return NextResponse.json({ error: resolvedParent.error }, { status: 400 });
  }

  const created = await prisma.teamRunComment.create({
    data: {
      teamId,
      runId,
      authorUserId: userId,
      parentId: resolvedParent.parentId,
      body: validated.body,
    },
    select: { id: true, createdAt: true, parentId: true },
  });

  const displays = await loadTeamMemberDisplays(target.memberIds, userId);
  const team = await prisma.team.findFirst({ where: { id: teamId }, select: { name: true } });

  // Fire and forget: a push failure must never fail the comment.
  void notifyTeamComment({
    teamId,
    teamName: team?.name ?? "Your team",
    runId,
    commentId: created.id,
    authorUserId: userId,
    authorLabel: displays.get(userId)?.name ?? "A teammate",
    body: validated.body,
  });

  return NextResponse.json({
    comment: {
      id: created.id,
      authorUserId: userId,
      authorLabel: displays.get(userId)?.label ?? "You",
      body: validated.body,
      createdAt: created.createdAt.toISOString(),
      editedAt: null,
      deletedAt: null,
      parentId: created.parentId,
      viewerCanEdit: true,
      viewerCanDelete: true,
    },
  });
}
