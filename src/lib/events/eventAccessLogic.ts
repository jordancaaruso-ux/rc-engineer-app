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

/** Everything the delete rule needs, counted by `loadEventDeleteFacts`. */
export type EventDeleteFacts = {
  /** Null for legacy events whose creator row was deleted. */
  creatorUserId: string | null;
  /** Other drivers on the meeting: a participation row, a run or an imported session of theirs. */
  othersOnIt: number;
};

export type EventDeleteBlock = "not-maker" | "others-on-it";

/**
 * Why this driver may NOT delete this meeting, or null when they may (founder ruling 2026-09-26:
 * "They must be able to delete it, if nobody else is on it").
 *
 * Only the driver who made it, and only while nobody else is on it. No admin override: an admin
 * cleans up with merge, which keeps everyone's runs together. A legacy meeting with no creator is
 * nobody's to delete.
 */
export function eventDeleteBlock(userId: string, facts: EventDeleteFacts): EventDeleteBlock | null {
  if (!facts.creatorUserId || facts.creatorUserId !== userId) return "not-maker";
  if (facts.othersOnIt > 0) return "others-on-it";
  return null;
}

/** Creator or app admin may edit shared Event fields (name, dates, URLs, track link). */
export function canEditSharedEventFields(
  user: EventAccessUser,
  event: { userId: string | null }
): boolean {
  if (event.userId == null) return isAuthAdminEmail(user.email);
  return event.userId === user.id || isAuthAdminEmail(user.email);
}
