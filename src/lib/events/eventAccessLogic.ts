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

/**
 * A meeting that carries a LiveRC results link is LiveRC's meeting, whoever's tap created the row.
 * Any driver at the race may join it (`mayJoinEvent`), so it has no racer "maker": the first
 * driver to pick it, or the driver whose own meeting was joined to it, is only its attribution
 * (`Event.userId`). Same test as the join rule, so "strangers can join it" and "no stranger
 * owns it" can never disagree.
 */
export function isLiveRcMeeting(event: { resultsSourceUrl: string | null }): boolean {
  return Boolean(event.resultsSourceUrl?.trim());
}

/** Everything the delete rule needs, counted by `loadEventDeleteFacts`. */
export type EventDeleteFacts = {
  /** Null for legacy events whose creator row was deleted. */
  creatorUserId: string | null;
  /** Set when the meeting is LiveRC's (see `isLiveRcMeeting`). */
  resultsSourceUrl: string | null;
  /** Other drivers on the meeting: a participation row, a run or an imported session of theirs. */
  othersOnIt: number;
};

export type EventDeleteBlock = "liverc-meeting" | "not-maker" | "others-on-it";

/**
 * Why this driver may NOT delete this meeting, or null when they may (founder ruling 2026-09-26:
 * "They must be able to delete it, if nobody else is on it").
 *
 * Only the driver who made it, and only while nobody else is on it. No admin override: an admin
 * cleans up with merge, which keeps everyone's runs together. A legacy meeting with no creator is
 * nobody's to delete, and neither is a LiveRC meeting: it has no racer maker (test drive
 * 2026-09-26, W1-01).
 */
export function eventDeleteBlock(userId: string, facts: EventDeleteFacts): EventDeleteBlock | null {
  if (isLiveRcMeeting(facts)) return "liverc-meeting";
  if (!facts.creatorUserId || facts.creatorUserId !== userId) return "not-maker";
  if (facts.othersOnIt > 0) return "others-on-it";
  return null;
}

/**
 * Who may change a meeting's shared fields (name, dates, links, track, race class): the driver who
 * made it, or an app admin. A LiveRC meeting has no racer maker, so only an admin: the first
 * driver to pick LiveRC's EMCC Cup could rename it and move its dates for every stranger at it
 * (test drive 2026-09-26, W1-01). Every driver on a meeting still saves their own notes, which
 * are not shared fields.
 */
export function canEditSharedEventFields(
  user: EventAccessUser,
  event: { userId: string | null; resultsSourceUrl: string | null }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  if (event.userId == null || isLiveRcMeeting(event)) return false;
  return event.userId === user.id;
}
