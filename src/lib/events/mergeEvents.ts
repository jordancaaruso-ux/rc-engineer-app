import { prisma } from "@/lib/prisma";
import { findEventByTrackAndResultsUrl } from "@/lib/events/findEventForLiveRc";

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

/** Repoint runs, sessions, participations from loser → winner; delete loser. */
export async function mergeEvents(input: { winnerId: string; loserId: string }): Promise<void> {
  const { winnerId, loserId } = input;
  if (winnerId === loserId) return;

  await prisma.$transaction(async (tx) => {
    await tx.run.updateMany({
      where: { eventId: loserId },
      data: { eventId: winnerId },
    });
    await tx.importedLapTimeSession.updateMany({
      where: { linkedEventId: loserId },
      data: { linkedEventId: winnerId },
    });

    const loserParts = await tx.eventParticipation.findMany({
      where: { eventId: loserId },
      select: {
        userId: true,
        notes: true,
        controlledTireLabel: true,
        controlledTireTypeId: true,
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
            pinnedAt: part.pinnedAt,
          },
        });
      }
    }

    await tx.eventParticipation.deleteMany({ where: { eventId: loserId } });
    await tx.event.delete({ where: { id: loserId } });
  });
}
