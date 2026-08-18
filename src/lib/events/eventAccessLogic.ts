import { isAuthAdminEmail } from "@/lib/authAdminLogic";

export type EventAccessUser = {
  id: string;
  email: string | null;
};

/** Everything the join rule needs, so the decision itself stays free of database calls. */
export type EventJoinFacts = {
  /** Already a participant, or has a run on it — nothing to decide. */
  alreadyOn: boolean;
  /** Null for legacy events whose creator row was deleted. */
  creatorUserId: string | null;
  /** Set when the event names a real LiveRC meeting. */
  resultsSourceUrl: string | null;
  /** Creator shares at least one team with the viewer. */
  creatorIsTeammate: boolean;
};

/**
 * May this user join this event? See `userMayJoinEvent` for why each route exists.
 *
 * Order matters only for cost, not correctness — any one route is enough.
 */
export function mayJoinEvent(userId: string, facts: EventJoinFacts): boolean {
  if (facts.alreadyOn) return true;
  if (facts.resultsSourceUrl?.trim()) return true;
  if (!facts.creatorUserId) return false;
  if (facts.creatorUserId === userId) return true;
  return facts.creatorIsTeammate;
}

/** Creator or app admin may edit shared Event fields (name, dates, URLs, track link). */
export function canEditSharedEventFields(
  user: EventAccessUser,
  event: { userId: string | null }
): boolean {
  if (event.userId == null) return isAuthAdminEmail(user.email);
  return event.userId === user.id || isAuthAdminEmail(user.email);
}
