import "server-only";

import { prisma } from "@/lib/prisma";
import { assertUserInTeam } from "@/lib/teamAccess";
import { driversAreConnected } from "@/lib/moderation/blocks";
import { parseAuthAdminEmails } from "@/lib/authAdmin";
import { sendPushToUser } from "@/lib/webPush/server";
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail";
import { BRAND_DOMAIN } from "@/lib/brand/brandNames";
import {
  REPORT_KIND_LABEL,
  REPORT_REASON_LABEL,
  reportExcerpt,
  type ReportInput,
} from "@/lib/moderation/reportRules";

/**
 * Filing a report and telling the founder (App Store guideline 1.2, 2026-09-26). The review queue
 * (`/admin/review`) lists open reports; Apple expects a response within 24 hours, so every report
 * pushes and emails every admin as it lands.
 */

type ResolvedTarget = { targetUserId: string | null; teamId: string | null; excerpt: string };

/**
 * What is being reported, who wrote or added it, and whether the reporter can see it at all. Null
 * means "not found" to the reporter, whether it doesn't exist or isn't theirs to see: a report is
 * not a way to learn what's in a team you aren't in.
 */
export async function resolveReportTarget(
  reporterUserId: string,
  input: ReportInput
): Promise<ResolvedTarget | null> {
  switch (input.kind) {
    case "comment": {
      const comment = await prisma.teamRunComment.findFirst({
        where: { id: input.targetId },
        select: { teamId: true, authorUserId: true, body: true, deletedAt: true },
      });
      if (!comment || comment.authorUserId === reporterUserId) return null;
      if (!(await assertUserInTeam(comment.teamId, reporterUserId))) return null;
      return {
        targetUserId: comment.authorUserId,
        teamId: comment.teamId,
        excerpt: reportExcerpt(comment.deletedAt ? "(deleted by its author)" : comment.body),
      };
    }
    case "driver": {
      if (input.targetId === reporterUserId) return null;
      if (!(await driversAreConnected(reporterUserId, input.targetId))) return null;
      const [driver, sharedTeam] = await Promise.all([
        prisma.user.findUnique({
          where: { id: input.targetId },
          select: { name: true, email: true },
        }),
        input.teamId
          ? prisma.teamMembership.findFirst({
              where: {
                teamId: input.teamId,
                userId: input.targetId,
                team: { memberships: { some: { userId: reporterUserId } } },
              },
              select: { teamId: true },
            })
          : Promise.resolve(null),
      ]);
      if (!driver) return null;
      const who = [driver.name?.trim(), driver.email?.trim()].filter(Boolean).join(" · ");
      return {
        targetUserId: input.targetId,
        teamId: sharedTeam?.teamId ?? null,
        excerpt: reportExcerpt(who || "(no name)"),
      };
    }
    case "track": {
      const track = await prisma.track.findUnique({
        where: { id: input.targetId },
        select: { name: true, location: true, userId: true },
      });
      if (!track) return null;
      return {
        targetUserId: track.userId,
        teamId: null,
        excerpt: reportExcerpt([track.name, track.location].filter(Boolean).join(" · ")),
      };
    }
    case "tire": {
      const tire = await prisma.tireType.findUnique({
        where: { id: input.targetId },
        select: { displayName: true, createdByUserId: true },
      });
      if (!tire) return null;
      return { targetUserId: tire.createdByUserId, teamId: null, excerpt: reportExcerpt(tire.displayName) };
    }
    case "chassis": {
      const chassis = await prisma.setupSheetModel.findUnique({
        where: { id: input.targetId },
        select: { name: true, userId: true },
      });
      if (!chassis) return null;
      return { targetUserId: chassis.userId, teamId: null, excerpt: reportExcerpt(chassis.name) };
    }
  }
}

/**
 * Save the report. Reporting the same thing again re-opens it with the new reason rather than
 * adding a second row, so one driver can't flood the queue.
 */
export async function saveReport(
  reporterUserId: string,
  input: ReportInput,
  target: ResolvedTarget
): Promise<{ id: string }> {
  return prisma.contentReport.upsert({
    where: {
      reporterUserId_kind_targetId: {
        reporterUserId,
        kind: input.kind,
        targetId: input.targetId,
      },
    },
    create: {
      reporterUserId,
      kind: input.kind,
      targetId: input.targetId,
      targetUserId: target.targetUserId,
      teamId: target.teamId,
      reason: input.reason,
      excerpt: target.excerpt,
    },
    update: {
      reason: input.reason,
      excerpt: target.excerpt,
      status: "open",
      resolvedAt: null,
    },
    select: { id: true },
  });
}

/**
 * Push and email every admin. Never throws: the report is saved before this runs, and the queue
 * shows it whether or not a message lands.
 */
export async function notifyAdminsOfReport(input: {
  kind: ReportInput["kind"];
  reason: ReportInput["reason"];
  excerpt: string;
  reporterEmail: string | null;
}): Promise<void> {
  const adminEmails = [...parseAuthAdminEmails()];
  if (adminEmails.length === 0) return;

  const kindLabel = REPORT_KIND_LABEL[input.kind];
  const reasonLabel = REPORT_REASON_LABEL[input.reason];
  const short = input.excerpt.length > 90 ? `${input.excerpt.slice(0, 89)}…` : input.excerpt;
  const queueUrl = `https://www.${BRAND_DOMAIN}/admin/review#reports`;

  try {
    const admins = await prisma.user.findMany({
      where: { email: { in: adminEmails } },
      select: { id: true },
    });
    await Promise.all([
      ...admins.map((admin) =>
        sendPushToUser(admin.id, {
          title: `Report: ${kindLabel.toLowerCase()} · ${reasonLabel.toLowerCase()}`,
          body: short,
          url: "/admin/review#reports",
          tag: "content-report",
        }).catch((error) => console.error("[content-report] push failed", error))
      ),
      ...adminEmails.map((to) =>
        sendTransactionalEmail(
          {
            to,
            subject: `Report to review within 24 hours: ${kindLabel.toLowerCase()}`,
            text: [
              `${kindLabel} reported as "${reasonLabel}".`,
              "",
              `What it says: ${input.excerpt}`,
              `Reported by: ${input.reporterEmail ?? "unknown"}`,
              "",
              `Review it: ${queueUrl}`,
            ].join("\n"),
            html: `<p><strong>${escapeHtml(kindLabel)}</strong> reported as "${escapeHtml(reasonLabel)}".</p>
<p>What it says: ${escapeHtml(input.excerpt)}</p>
<p>Reported by: ${escapeHtml(input.reporterEmail ?? "unknown")}</p>
<p><a href="${queueUrl}">Review it</a></p>`,
          },
          { label: "content-report" }
        ).catch((error) => console.error("[content-report] email failed", error))
      ),
    ]);
  } catch (error) {
    console.error("[content-report] admin notify failed", error);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
