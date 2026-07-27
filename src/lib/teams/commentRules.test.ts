/**
 * Run: `npx tsx --test src/lib/teams/commentRules.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMENT_MAX_LENGTH,
  canEditComment,
  resolveCommentDeleteMode,
  resolveCommentNotifyRecipients,
  resolveReplyParentId,
  teamCommentNotificationTag,
  validateCommentBody,
} from "@/lib/teams/commentRules";

test("comment body is trimmed and must not be empty", () => {
  assert.deepEqual(validateCommentBody("  track's come in  "), {
    ok: true,
    body: "track's come in",
  });
  assert.equal(validateCommentBody("   ").ok, false);
  assert.equal(validateCommentBody("").ok, false);
  assert.equal(validateCommentBody(undefined).ok, false);
  assert.equal(validateCommentBody(42).ok, false);
});

test("comment body is length capped", () => {
  assert.equal(validateCommentBody("x".repeat(COMMENT_MAX_LENGTH)).ok, true);
  assert.equal(validateCommentBody("x".repeat(COMMENT_MAX_LENGTH + 1)).ok, false);
});

test("a root comment has no parent", () => {
  assert.deepEqual(resolveReplyParentId(null, { teamId: "t1", runId: "r1" }), {
    ok: true,
    parentId: null,
  });
});

test("replying to a reply flattens onto its root", () => {
  const result = resolveReplyParentId(
    { id: "c2", teamId: "t1", runId: "r1", parentId: "c1" },
    { teamId: "t1", runId: "r1" }
  );
  assert.deepEqual(result, { ok: true, parentId: "c1" });
});

test("a parent from another team or run is rejected", () => {
  assert.equal(
    resolveReplyParentId(
      { id: "c1", teamId: "other-team", runId: "r1", parentId: null },
      { teamId: "t1", runId: "r1" }
    ).ok,
    false
  );
  assert.equal(
    resolveReplyParentId(
      { id: "c1", teamId: "t1", runId: "other-run", parentId: null },
      { teamId: "t1", runId: "r1" }
    ).ok,
    false
  );
});

test("only the author edits, and not after deleting", () => {
  const comment = { authorUserId: "dave", deletedAt: null };
  assert.equal(canEditComment(comment, { userId: "dave", isTeamAdmin: false }), true);
  assert.equal(canEditComment(comment, { userId: "kirra", isTeamAdmin: true }), false);
  assert.equal(
    canEditComment({ authorUserId: "dave", deletedAt: new Date() }, { userId: "dave", isTeamAdmin: false }),
    false
  );
});

test("author soft-deletes, admin hard-deletes, nobody else can", () => {
  const comment = { authorUserId: "dave", deletedAt: null };
  assert.equal(resolveCommentDeleteMode(comment, { userId: "dave", isTeamAdmin: false }), "soft");
  assert.equal(resolveCommentDeleteMode(comment, { userId: "kirra", isTeamAdmin: true }), "hard");
  assert.equal(resolveCommentDeleteMode(comment, { userId: "sam", isTeamAdmin: false }), null);
});

test("already-deleted comments cannot be soft-deleted again", () => {
  const comment = { authorUserId: "dave", deletedAt: new Date() };
  assert.equal(resolveCommentDeleteMode(comment, { userId: "dave", isTeamAdmin: false }), null);
});

test("notify the run owner and prior commenters, never the author", () => {
  const recipients = resolveCommentNotifyRecipients({
    runOwnerUserId: "dave",
    priorCommenterUserIds: ["kirra", "sam"],
    authorUserId: "kirra",
    teamMemberUserIds: ["dave", "kirra", "sam", "quiet"],
  });
  assert.deepEqual(recipients.sort(), ["dave", "sam"]);
});

test("notifications never reach the whole team", () => {
  const recipients = resolveCommentNotifyRecipients({
    runOwnerUserId: "dave",
    priorCommenterUserIds: [],
    authorUserId: "kirra",
    teamMemberUserIds: ["dave", "kirra", "sam", "quiet"],
  });
  assert.deepEqual(recipients, ["dave"]);
});

test("someone who has left the team is not notified", () => {
  const recipients = resolveCommentNotifyRecipients({
    runOwnerUserId: "dave",
    priorCommenterUserIds: ["departed"],
    authorUserId: "kirra",
    teamMemberUserIds: ["dave", "kirra"],
  });
  assert.deepEqual(recipients, ["dave"]);
});

test("the author commenting on their own run notifies nobody", () => {
  const recipients = resolveCommentNotifyRecipients({
    runOwnerUserId: "dave",
    priorCommenterUserIds: [],
    authorUserId: "dave",
    teamMemberUserIds: ["dave", "kirra"],
  });
  assert.deepEqual(recipients, []);
});

test("notification tag is stable per thread so pushes replace rather than stack", () => {
  assert.equal(teamCommentNotificationTag("t1", "r1"), "team-comment:t1:r1");
  assert.notEqual(teamCommentNotificationTag("t1", "r1"), teamCommentNotificationTag("t2", "r1"));
});
