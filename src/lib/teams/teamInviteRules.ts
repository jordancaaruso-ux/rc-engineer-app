/**
 * Pure decision rules for team invites — no Prisma, no request objects, so the consent logic that
 * guards a whole run history is unit-testable without a database.
 *
 * The API routes are responsible for loading rows and for the admin check; everything about *which
 * transitions are legal and who may make them* lives here. Each helper returns the HTTP status the
 * route should use, so the same rule can't be spelled two different ways in two routes.
 */

export type TeamInviteStatus = "pending" | "accepted" | "declined" | "revoked";

export type TeamInviteAction = "accept" | "decline";

/** Statuses that are no longer live: re-inviting overwrites these, responding to them is a 409. */
const TERMINAL_STATUSES: readonly TeamInviteStatus[] = ["accepted", "declined", "revoked"];

/** Unknown/legacy values are treated as terminal rather than pending — fail closed, not open. */
export function normalizeInviteStatus(raw: string | null | undefined): TeamInviteStatus | null {
  if (raw === "pending" || raw === "accepted" || raw === "declined" || raw === "revoked") {
    return raw;
  }
  return null;
}

export function isInvitePending(raw: string | null | undefined): boolean {
  return normalizeInviteStatus(raw) === "pending";
}

export function isInviteTerminal(raw: string | null | undefined): boolean {
  const status = normalizeInviteStatus(raw);
  return status == null || TERMINAL_STATUSES.includes(status);
}

export type RuleFailure = { ok: false; status: 400 | 403 | 404 | 409; error: string };

export type InviteCreateDecision =
  | { ok: true; mode: "create" | "reset" }
  | RuleFailure;

/**
 * Whether an admin may invite this person, and whether that means a fresh row or resetting the
 * existing one back to `pending`.
 *
 * `mode: "reset"` exists because `TeamInvite` is unique per (team, user) for all time: a driver who
 * declined last season must be invitable again, and that reuses the same row.
 */
export function checkInviteCreate(input: {
  /** Resolved from the submitted email; null when no account matches. */
  targetUserId: string | null;
  inviterUserId: string;
  /** Result of `isEmailAuthAllowed` for the target. */
  targetIsAllowlisted: boolean;
  targetIsAlreadyMember: boolean;
  /** `status` of any existing invite for this (team, user), or null if there is none. */
  existingInviteStatus: string | null;
}): InviteCreateDecision {
  if (!input.targetUserId) {
    return { ok: false, status: 404, error: "No user found with that email" };
  }
  if (input.targetUserId === input.inviterUserId) {
    return { ok: false, status: 400, error: "You are already on this team" };
  }
  if (!input.targetIsAllowlisted) {
    return {
      ok: false,
      status: 403,
      error: "That user’s email is not on the sign-in allowlist for this app.",
    };
  }
  if (input.targetIsAlreadyMember) {
    return { ok: false, status: 409, error: "User is already a member" };
  }
  if (input.existingInviteStatus == null) {
    return { ok: true, mode: "create" };
  }
  if (isInvitePending(input.existingInviteStatus)) {
    return { ok: false, status: 409, error: "That user already has a pending invite" };
  }
  return { ok: true, mode: "reset" };
}

export type InviteResponseDecision =
  | { ok: true; nextStatus: "accepted" | "declined" }
  | RuleFailure;

/**
 * Whether this caller may accept/decline this invite. The invited user is the *only* account that
 * may respond — an admin accepting on someone's behalf would reintroduce the original flaw.
 */
export function checkInviteResponse(input: {
  invite: { invitedUserId: string; status: string } | null;
  responderUserId: string;
  action: TeamInviteAction;
}): InviteResponseDecision {
  const { invite } = input;
  if (!invite) {
    return { ok: false, status: 404, error: "Invite not found" };
  }
  // 404 rather than 403 so an invite's existence isn't probeable by a non-invitee.
  if (invite.invitedUserId !== input.responderUserId) {
    return { ok: false, status: 404, error: "Invite not found" };
  }
  if (!isInvitePending(invite.status)) {
    return { ok: false, status: 409, error: "That invite is no longer pending" };
  }
  return { ok: true, nextStatus: input.action === "accept" ? "accepted" : "declined" };
}

export type InviteRevokeDecision = { ok: true } | RuleFailure;

/** Admins may withdraw an invite, but only while it is still pending. */
export function checkInviteRevoke(input: {
  invite: { teamId: string; status: string } | null;
  teamId: string;
  viewerIsTeamAdmin: boolean;
}): InviteRevokeDecision {
  if (!input.viewerIsTeamAdmin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (!input.invite || input.invite.teamId !== input.teamId) {
    return { ok: false, status: 404, error: "Invite not found" };
  }
  if (!isInvitePending(input.invite.status)) {
    return { ok: false, status: 409, error: "That invite is no longer pending" };
  }
  return { ok: true };
}

/** Body parser for the respond route — anything that isn't exactly accept/decline is rejected. */
export function parseInviteAction(raw: unknown): TeamInviteAction | null {
  return raw === "accept" || raw === "decline" ? raw : null;
}
