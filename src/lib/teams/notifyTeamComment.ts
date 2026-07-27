import "server-only";

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/webPush/server";
import { listTeamMemberUserIds } from "@/lib/teamAccess";
import { resolveCommentNotifyRecipients, teamCommentNotificationTag } from "@/lib/teams/commentRules";

/**
 * Best-effort push when a comment lands on a run in a team feed.
 *
 * Goes to the run's owner and to everyone already talking on that run in this team — never
 * the whole team. An unread badge for every member on every comment is exactly what makes
 * people mute a feed, and the feed is the product.
 *
 * The shared `tag` matters: `public/sw.js` passes it to `showNotification`, so a second
 * comment on the same thread replaces the first notification instead of stacking another one
 * on a driver's lock screen mid-meeting.
 *
 * Never throws — posting a comment must not depend on the push landing.
 */
export async function notifyTeamComment(input: {
  teamId: string;
  teamName: string;
  runId: string;
  commentId: string;
  authorUserId: string;
  authorLabel: string;
  body: string;
}): Promise<void> {
  try {
    const [run, priorComments, memberIds] = await Promise.all([
      prisma.run.findFirst({ where: { id: input.runId }, select: { userId: true } }),
      prisma.teamRunComment.findMany({
        where: { teamId: input.teamId, runId: input.runId, id: { not: input.commentId } },
        select: { authorUserId: true },
        distinct: ["authorUserId"],
      }),
      listTeamMemberUserIds(input.teamId),
    ]);
    if (!run) return;

    const recipients = resolveCommentNotifyRecipients({
      runOwnerUserId: run.userId,
      priorCommenterUserIds: priorComments.map((c) => c.authorUserId),
      authorUserId: input.authorUserId,
      teamMemberUserIds: memberIds,
    });
    if (recipients.length === 0) return;

    const preview = input.body.length > 120 ? `${input.body.slice(0, 119)}…` : input.body;
    const url = `/teams/${encodeURIComponent(input.teamId)}?run=${encodeURIComponent(
      input.runId
    )}#c-${encodeURIComponent(input.commentId)}`;

    await Promise.all(
      recipients.map((userId) =>
        sendPushToUser(userId, {
          title: `${input.authorLabel} · ${input.teamName}`,
          body: preview,
          url,
          tag: teamCommentNotificationTag(input.teamId, input.runId),
        }).catch((error) => {
          console.error("[team-comment] push failed", error);
        })
      )
    );
  } catch (error) {
    console.error("[team-comment] notify failed", error);
  }
}
