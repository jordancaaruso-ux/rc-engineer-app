import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { removeTeamMember } from "@/lib/teams/removeTeamMember";
import {
  isReportKind,
  parseReportAction,
  reportCanRemove,
} from "@/lib/moderation/reportRules";

type Ctx = { params: Promise<{ reportId: string }> };

/**
 * The founder acts on a report from the review queue. Body: `{ action: "remove" | "dismiss" }`.
 *
 * Remove deletes a reported comment (its replies go with it, as with a team admin's delete) or
 * takes a reported driver out of the team they were reported from. Either action closes every
 * open report on the same thing, so three drivers reporting one comment is one decision.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { reportId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = parseReportAction(body?.action);
  if (!action) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const report = await prisma.contentReport.findUnique({
    where: { id: reportId },
    select: { kind: true, targetId: true, targetUserId: true, teamId: true },
  });
  if (!report || !isReportKind(report.kind)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "remove") {
    if (!reportCanRemove(report.kind, report.teamId)) {
      return NextResponse.json(
        { error: "Remove this from its own page, then dismiss the report." },
        { status: 400 }
      );
    }
    if (report.kind === "comment") {
      await prisma.teamRunComment.deleteMany({ where: { id: report.targetId } });
    } else if (report.kind === "driver" && report.teamId) {
      await removeTeamMember(report.teamId, report.targetId);
    }
  }

  const closed = await prisma.contentReport.updateMany({
    where: {
      kind: report.kind,
      targetId: report.targetId,
      ...(report.kind === "driver" ? { teamId: report.teamId } : {}),
      status: "open",
    },
    data: { status: action === "remove" ? "removed" : "dismissed", resolvedAt: new Date() },
  });

  return NextResponse.json({ ok: true, closed: closed.count });
}
