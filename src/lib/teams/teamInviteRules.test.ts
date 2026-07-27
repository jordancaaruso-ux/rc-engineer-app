/**
 * Run: `npm run test:teams`
 *
 * These cover the consent gate itself: before TeamInvite existed, an admin typing your email got
 * mutual retroactive access to your whole run history. The cases that matter are the ones where
 * someone other than the invited user tries to move the invite forward.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkInviteCreate,
  checkInviteResponse,
  checkInviteRevoke,
  isInvitePending,
  isInviteTerminal,
  normalizeInviteStatus,
  parseInviteAction,
} from "@/lib/teams/teamInviteRules";

const ALLOWED_TARGET = {
  targetUserId: "peer",
  inviterUserId: "admin",
  targetIsAllowlisted: true,
  targetIsAlreadyMember: false,
  existingInviteStatus: null,
};

test("unknown invite status is treated as terminal, not pending", () => {
  assert.equal(normalizeInviteStatus("weird"), null);
  assert.equal(isInvitePending("weird"), false);
  assert.equal(isInviteTerminal("weird"), true);
  assert.equal(isInvitePending(null), false);
  assert.equal(isInvitePending("pending"), true);
});

test("invite creation requires a real, allowlisted, non-member account", () => {
  assert.deepEqual(checkInviteCreate({ ...ALLOWED_TARGET, targetUserId: null }), {
    ok: false,
    status: 404,
    error: "No user found with that email",
  });

  const notAllowlisted = checkInviteCreate({ ...ALLOWED_TARGET, targetIsAllowlisted: false });
  assert.equal(notAllowlisted.ok, false);
  assert.equal(notAllowlisted.ok === false && notAllowlisted.status, 403);

  const alreadyMember = checkInviteCreate({ ...ALLOWED_TARGET, targetIsAlreadyMember: true });
  assert.equal(alreadyMember.ok, false);
  assert.equal(alreadyMember.ok === false && alreadyMember.status, 409);

  const self = checkInviteCreate({ ...ALLOWED_TARGET, targetUserId: "admin" });
  assert.equal(self.ok, false);
  assert.equal(self.ok === false && self.status, 400);
});

test("a fresh invite creates, and a duplicate pending invite is rejected", () => {
  assert.deepEqual(checkInviteCreate(ALLOWED_TARGET), { ok: true, mode: "create" });

  const duplicate = checkInviteCreate({ ...ALLOWED_TARGET, existingInviteStatus: "pending" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.ok === false && duplicate.status, 409);
});

test("re-inviting after decline, revoke, or a removed membership resets the same row to pending", () => {
  for (const previous of ["declined", "revoked", "accepted"]) {
    assert.deepEqual(
      checkInviteCreate({ ...ALLOWED_TARGET, existingInviteStatus: previous }),
      { ok: true, mode: "reset" },
      `re-invite after ${previous} should reset`
    );
  }
});

test("only the invited user may respond — nobody else can accept on their behalf", () => {
  const invite = { invitedUserId: "peer", status: "pending" };

  assert.deepEqual(checkInviteResponse({ invite, responderUserId: "peer", action: "accept" }), {
    ok: true,
    nextStatus: "accepted",
  });
  assert.deepEqual(checkInviteResponse({ invite, responderUserId: "peer", action: "decline" }), {
    ok: true,
    nextStatus: "declined",
  });

  // 404, not 403: a stranger must not be able to confirm an invite exists.
  const outsider = checkInviteResponse({ invite, responderUserId: "admin", action: "accept" });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.ok === false && outsider.status, 404);

  const missing = checkInviteResponse({ invite: null, responderUserId: "peer", action: "accept" });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.status, 404);
});

test("a revoked, declined or already-accepted invite cannot be accepted again", () => {
  for (const status of ["revoked", "declined", "accepted"]) {
    const decision = checkInviteResponse({
      invite: { invitedUserId: "peer", status },
      responderUserId: "peer",
      action: "accept",
    });
    assert.equal(decision.ok, false, `${status} must not be acceptable`);
    assert.equal(decision.ok === false && decision.status, 409);
  }
});

test("revoke is admin-only and pending-only", () => {
  const invite = { teamId: "t1", status: "pending" };

  assert.deepEqual(checkInviteRevoke({ invite, teamId: "t1", viewerIsTeamAdmin: true }), { ok: true });

  const notAdmin = checkInviteRevoke({ invite, teamId: "t1", viewerIsTeamAdmin: false });
  assert.equal(notAdmin.ok, false);
  assert.equal(notAdmin.ok === false && notAdmin.status, 403);

  // Invite id from another team must not be revocable via this team's route (IDOR guard).
  const wrongTeam = checkInviteRevoke({ invite, teamId: "t2", viewerIsTeamAdmin: true });
  assert.equal(wrongTeam.ok, false);
  assert.equal(wrongTeam.ok === false && wrongTeam.status, 404);

  const settled = checkInviteRevoke({
    invite: { teamId: "t1", status: "accepted" },
    teamId: "t1",
    viewerIsTeamAdmin: true,
  });
  assert.equal(settled.ok, false);
  assert.equal(settled.ok === false && settled.status, 409);
});

test("only exact accept/decline actions parse", () => {
  assert.equal(parseInviteAction("accept"), "accept");
  assert.equal(parseInviteAction("decline"), "decline");
  assert.equal(parseInviteAction("ACCEPT"), null);
  assert.equal(parseInviteAction(undefined), null);
  assert.equal(parseInviteAction({ action: "accept" }), null);
});
