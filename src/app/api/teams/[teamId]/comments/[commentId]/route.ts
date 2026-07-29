import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { assertTeamAdmin, assertUserInTeam } from "@/lib/teamAccess";
import {
  canEditComment,
  resolveCommentDeleteMode,
  validateCommentBody,
} from "@/lib/teams/commentRules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ teamId: string; commentId: string }> };

async function loadComment(teamId: string, commentId: string, viewerId: string) {
  if (!(await assertUserInTeam(teamId, viewerId))) return null;
  const comment = await prisma.teamRunComment.findFirst({
    where: { id: commentId, teamId },
    select: { id: true, authorUserId: true, deletedAt: true },
  });
  return comment;
}

/** Edit your own comment. */
export async function PATCH(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId, commentId } = await ctx.params;
  const comment = await loadComment(teamId, commentId, userId);
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isTeamAdmin = await assertTeamAdmin(teamId, userId);
  if (!canEditComment(comment, { userId: userId, isTeamAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const validated = validateCommentBody(payload?.body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const updated = await prisma.teamRunComment.update({
    where: { id: commentId },
    data: { body: validated.body },
    select: { id: true, body: true, updatedAt: true },
  });

  return NextResponse.json({
    comment: {
      id: updated.id,
      body: updated.body,
      editedAt: updated.updatedAt.toISOString(),
    },
  });
}

/**
 * Author soft-deletes (body blanked, row kept so replies keep their anchor); a team admin
 * hard-deletes as a moderation escape hatch, which cascades to replies.
 */
export async function DELETE(_request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId, commentId } = await ctx.params;
  const comment = await loadComment(teamId, commentId, userId);
  if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isTeamAdmin = await assertTeamAdmin(teamId, userId);
  const mode = resolveCommentDeleteMode(comment, { userId: userId, isTeamAdmin });
  if (!mode) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (mode === "hard") {
    await prisma.teamRunComment.delete({ where: { id: commentId } });
    return NextResponse.json({ ok: true, mode });
  }

  await prisma.teamRunComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date(), body: "" },
  });
  return NextResponse.json({ ok: true, mode });
}
