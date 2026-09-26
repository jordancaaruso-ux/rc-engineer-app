import { prisma } from "@/lib/prisma";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";

/**
 * Where a merged-away meeting went, noted per driver who was on it: an `AppSetting` row keyed
 * `eventMergedInto:<old id>` holding the id it joined. The old page reads it to send them on
 * (test drive 2026-09-26, W1-11: a meeting that joined LiveRC's left its old address blank).
 */
const MERGED_INTO_KEY_PREFIX = "eventMergedInto:";

/**
 * When setting resultsSourceUrl on an event, merge into an existing global row if one
 * already exists for the same track + LiveRC hub. Returns the surviving event id.
 */
export async function mergeEventIntoExistingByResultsUrl(input: {
  sourceEventId: string;
  trackId: string;
  resultsSourceUrl: string;
}): Promise<{ merged: boolean; eventId: string }> {
  const existing = await findEventByTrackAndResultsUrl(input.trackId, input.resultsSourceUrl);
  if (!existing || existing.id === input.sourceEventId) {
    return { merged: false, eventId: input.sourceEventId };
  }

  await mergeEvents({ winnerId: existing.id, loserId: input.sourceEventId });
  return { merged: true, eventId: existing.id };
}

/** Repoint runs, sessions, participations and debriefs from loser → winner; delete loser. */
export async function mergeEvents(input: { winnerId: string; loserId: string }): Promise<void> {
  const { winnerId, loserId } = input;
  if (winnerId === loserId) return;

  const driversOnLoser = await prisma.$transaction(async (tx) => {
    // Who could open the loser's page (a participation row or a run), read before it goes.
    const runOwners = await tx.run.findMany({
      where: { eventId: loserId },
      distinct: ["userId"],
      select: { userId: true },
    });

    await tx.run.updateMany({
      where: { eventId: loserId },
      data: { eventId: winnerId },
    });
    await tx.importedLapTimeSession.updateMany({
      where: { linkedEventId: loserId },
      data: { linkedEventId: winnerId },
    });

    // A debrief is keyed by its Sessions group, and the loser's runs now group under the winner.
    // Move each one across unless the driver already wrote one there; that one stays where it is
    // and is still found by its day and track (see MeetingDebrief).
    const loserDebriefs = await tx.meetingDebrief.findMany({
      where: { eventId: loserId },
      select: { id: true, userId: true },
    });
    for (const debrief of loserDebriefs) {
      const clash = await tx.meetingDebrief.findUnique({
        where: { userId_meetingKey: { userId: debrief.userId, meetingKey: `event-${winnerId}` } },
        select: { id: true },
      });
      if (clash) continue;
      await tx.meetingDebrief.update({
        where: { id: debrief.id },
        data: { eventId: winnerId, meetingKey: `event-${winnerId}` },
      });
    }

    const loserParts = await tx.eventParticipation.findMany({
      where: { eventId: loserId },
      select: {
        userId: true,
        notes: true,
        controlledTireLabel: true,
        controlledTireTypeId: true,
        controlledAdditiveTypeId: true,
        pinnedAt: true,
      },
    });

    for (const part of loserParts) {
      const existing = await tx.eventParticipation.findUnique({
        where: { userId_eventId: { userId: part.userId, eventId: winnerId } },
        select: { id: true },
      });
      if (existing) {
        await tx.eventParticipation.update({
          where: { id: existing.id },
          data: {
            notes: part.notes ?? undefined,
            controlledTireLabel: part.controlledTireLabel ?? undefined,
            controlledTireTypeId: part.controlledTireTypeId ?? undefined,
            controlledAdditiveTypeId: part.controlledAdditiveTypeId ?? undefined,
            pinnedAt: part.pinnedAt ?? undefined,
          },
        });
      } else {
        await tx.eventParticipation.create({
          data: {
            userId: part.userId,
            eventId: winnerId,
            notes: part.notes,
            controlledTireLabel: part.controlledTireLabel,
            controlledTireTypeId: part.controlledTireTypeId,
            controlledAdditiveTypeId: part.controlledAdditiveTypeId,
            pinnedAt: part.pinnedAt,
          },
        });
      }
    }

    await tx.eventParticipation.deleteMany({ where: { eventId: loserId } });
    await tx.event.delete({ where: { id: loserId } });
    return [...new Set([...loserParts.map((p) => p.userId), ...runOwners.map((r) => r.userId)])];
  });

  await rememberMergedEvent(driversOnLoser, loserId, winnerId);
}

/** Best effort, after the merge: a failure here only costs the old page its forwarding. */
async function rememberMergedEvent(userIds: string[], loserId: string, winnerId: string) {
  if (userIds.length === 0) return;
  const key = `${MERGED_INTO_KEY_PREFIX}${loserId}`;
  try {
    await prisma.appSetting.createMany({
      data: userIds.map((userId) => ({ userId, key, value: winnerId })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.warn("[mergeEvents] could not note where the meeting went", loserId, err);
  }
}

/**
 * The meeting a merged-away one joined, as noted for this driver, following any later merge; null
 * when nothing was noted or that one is gone too. The caller still checks the driver can open it.
 */
export async function findMergedEventFor(userId: string, eventId: string): Promise<string | null> {
  let id = eventId;
  try {
    for (let hop = 0; hop < 4; hop += 1) {
      const note = await prisma.appSetting.findUnique({
        where: { userId_key: { userId, key: `${MERGED_INTO_KEY_PREFIX}${id}` } },
        select: { value: true },
      });
      if (!note?.value) return null;
      id = note.value;
      const survivor = await prisma.event.findUnique({ where: { id }, select: { id: true } });
      if (survivor) return survivor.id;
    }
  } catch (err) {
    console.warn("[mergeEvents] could not read where the meeting went", eventId, err);
  }
  return null;
}
