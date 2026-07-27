/**
 * Team run comment rules — pure validation and permission logic.
 *
 * Keep this file Prisma-free so `npx tsx src/lib/teams/commentRules.test.ts` runs offline.
 * Every rule here is also the thing the API routes enforce; nothing may be trusted from
 * the client.
 */

export const COMMENT_MAX_LENGTH = 2000;

export type CommentValidation =
  | { ok: true; body: string }
  | { ok: false; error: string };

/** Trim, reject empty, cap length. Plain text only — no markdown, no attachments. */
export function validateCommentBody(raw: unknown): CommentValidation {
  if (typeof raw !== "string") return { ok: false, error: "Comment must be text" };
  const body = raw.trim();
  if (!body) return { ok: false, error: "Comment cannot be empty" };
  if (body.length > COMMENT_MAX_LENGTH) {
    return { ok: false, error: `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer` };
  }
  return { ok: true, body };
}

export type ParentComment = {
  id: string;
  teamId: string;
  runId: string;
  parentId: string | null;
};

/**
 * Replies are one level deep — threads, not trees. A reply's parent must be a root
 * comment on the same run in the same team; replying to a reply attaches to its root.
 *
 * Returns the id to store in `parentId`, or an error when the parent doesn't belong
 * to this (run, team) — that would be a cross-team leak, not a user mistake.
 */
export function resolveReplyParentId(
  parent: ParentComment | null,
  target: { teamId: string; runId: string }
): { ok: true; parentId: string | null } | { ok: false; error: string } {
  if (!parent) return { ok: true, parentId: null };
  if (parent.teamId !== target.teamId || parent.runId !== target.runId) {
    return { ok: false, error: "Parent comment is not on this run" };
  }
  // Replying to a reply flattens onto its root, so the thread never nests further.
  return { ok: true, parentId: parent.parentId ?? parent.id };
}

export type CommentForPermission = {
  authorUserId: string;
  deletedAt: Date | string | null;
};

export type ViewerForPermission = {
  userId: string;
  isTeamAdmin: boolean;
};

/** Only the author edits their own words, and never after deleting them. */
export function canEditComment(
  comment: CommentForPermission,
  viewer: ViewerForPermission
): boolean {
  if (comment.deletedAt != null) return false;
  return comment.authorUserId === viewer.userId;
}

/**
 * The author soft-deletes their own comment; a team admin hard-deletes any comment in
 * their team as a moderation escape hatch.
 *
 * The run owner is deliberately NOT included: their lever is turning off
 * `shareWithTeam`, which removes the whole entry rather than editing what was said
 * about it.
 */
export function resolveCommentDeleteMode(
  comment: CommentForPermission,
  viewer: ViewerForPermission
): "soft" | "hard" | null {
  if (comment.authorUserId === viewer.userId) return comment.deletedAt != null ? null : "soft";
  if (viewer.isTeamAdmin) return "hard";
  return null;
}

/**
 * Who gets a push when a comment lands: the run's owner and everyone already talking on
 * that run in this team, minus the author, minus anyone who has since left the team.
 *
 * Never the whole team — an unread badge for every member on every comment is the thing
 * that makes people mute a feed.
 */
export function resolveCommentNotifyRecipients(params: {
  runOwnerUserId: string;
  priorCommenterUserIds: readonly string[];
  authorUserId: string;
  teamMemberUserIds: readonly string[];
}): string[] {
  const members = new Set(params.teamMemberUserIds);
  const recipients = new Set<string>([params.runOwnerUserId, ...params.priorCommenterUserIds]);
  recipients.delete(params.authorUserId);
  return [...recipients].filter((userId) => members.has(userId));
}

/**
 * Stable notification tag per thread. `public/sw.js` passes `tag` to `showNotification`,
 * so a second comment on the same run *replaces* the first notification instead of
 * stacking another one on the driver's lock screen.
 */
export function teamCommentNotificationTag(teamId: string, runId: string): string {
  return `team-comment:${teamId}:${runId}`;
}
