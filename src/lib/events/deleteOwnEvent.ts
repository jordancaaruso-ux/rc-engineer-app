import { prisma } from "@/lib/prisma";
import { eventDeleteBlock, type EventDeleteBlock, type EventDeleteFacts } from "@/lib/events/eventAccessLogic";

type Db = Pick<typeof prisma, "event" | "eventParticipation" | "run" | "importedLapTimeSession">;

/** How many other drivers are on a meeting: a participation row, a run or an imported session. */
async function countOthersOnEvent(db: Db, eventId: string, userId: string): Promise<number> {
  const [parts, runs, sessions] = await Promise.all([
    db.eventParticipation.count({ where: { eventId, userId: { not: userId } } }),
    db.run.count({ where: { eventId, userId: { not: userId } } }),
    db.importedLapTimeSession.count({ where: { linkedEventId: eventId, userId: { not: userId } } }),
  ]);
  return parts + runs + sessions;
}

export type EventDeleteView = {
  facts: EventDeleteFacts;
  block: EventDeleteBlock | null;
  /** The viewer's own runs on it: they stay, as days at the meeting's track. */
  myRunCount: number;
};

/** What the meeting's page needs to decide whether to offer Delete. Null when there is no such meeting. */
export async function loadEventDeleteView(eventId: string, userId: string): Promise<EventDeleteView | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { userId: true, resultsSourceUrl: true },
  });
  if (!event) return null;
  const [othersOnIt, myRunCount] = await Promise.all([
    countOthersOnEvent(prisma, eventId, userId),
    prisma.run.count({ where: { eventId, userId } }),
  ]);
  const facts: EventDeleteFacts = {
    creatorUserId: event.userId,
    resultsSourceUrl: event.resultsSourceUrl,
    othersOnIt,
  };
  return { facts, block: eventDeleteBlock(userId, facts), myRunCount };
}

export type DeleteOwnEventResult =
  | { ok: true; runsKept: number }
  | { ok: false; reason: "not-found" | EventDeleteBlock };

/**
 * Delete a meeting its maker made, while nobody else is on it (founder ruling 2026-09-26). Never a
 * LiveRC meeting: it has no racer maker (`eventDeleteBlock`).
 *
 * The maker's runs stay, as days at the meeting's track: the event link goes, the date and track
 * stay, so Sessions shows each day on its own (buildRunHistoryGroups groups by track name and day).
 * A run logged with no track of its own takes the meeting's first, or it would drop out of the day.
 * Debriefs keep their text: MeetingDebrief.eventId nulls itself and the note is found again by day
 * and track. Participation rows go with the meeting (onDelete: Cascade).
 *
 * Everything is re-checked inside the transaction, so a driver who joins mid-delete stops it.
 */
export async function deleteOwnEvent(eventId: string, userId: string): Promise<DeleteOwnEventResult> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        userId: true,
        resultsSourceUrl: true,
        trackId: true,
        track: { select: { name: true } },
        trackNameSnapshot: true,
      },
    });
    if (!event) return { ok: false, reason: "not-found" } as const;

    const othersOnIt = await countOthersOnEvent(tx, eventId, userId);
    const block = eventDeleteBlock(userId, {
      creatorUserId: event.userId,
      resultsSourceUrl: event.resultsSourceUrl,
      othersOnIt,
    });
    if (block) return { ok: false, reason: block } as const;

    if (event.trackId) {
      await tx.run.updateMany({
        where: { eventId, userId, trackId: null },
        data: { trackId: event.trackId, trackNameSnapshot: event.track?.name ?? event.trackNameSnapshot ?? undefined },
      });
    }
    const runs = await tx.run.updateMany({ where: { eventId, userId }, data: { eventId: null } });
    await tx.importedLapTimeSession.updateMany({
      where: { linkedEventId: eventId, userId },
      data: { linkedEventId: null },
    });
    await tx.event.delete({ where: { id: eventId } });
    return { ok: true, runsKept: runs.count } as const;
  });
}
