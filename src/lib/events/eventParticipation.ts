import { prisma } from "@/lib/prisma";
import {
  isLegacyEventTrack,
  resolveEventTrackLabel,
} from "@/lib/tracks/legacyTrackSnapshot";

export const EVENT_PARTICIPATION_TIRE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
} as const;

export const EVENT_PARTICIPATION_ADDITIVE_SELECT = EVENT_PARTICIPATION_TIRE_SELECT;

export const EVENT_LIST_INCLUDE = {
  track: { select: { id: true, name: true, location: true } },
  participations: {
    select: {
      id: true,
      userId: true,
      notes: true,
      controlledTireLabel: true,
      controlledTireTypeId: true,
      controlledAdditiveTypeId: true,
      pinnedAt: true,
      controlledTireType: { select: EVENT_PARTICIPATION_TIRE_SELECT },
      controlledAdditiveType: { select: EVENT_PARTICIPATION_ADDITIVE_SELECT },
    },
  },
} as const;

/** Ensure the user has a participation row (auto-join on create / first run). */
export async function ensureEventParticipation(input: {
  userId: string;
  eventId: string;
  notes?: string | null;
  controlledTireLabel?: string | null;
  controlledTireTypeId?: string | null;
  controlledAdditiveTypeId?: string | null;
}): Promise<void> {
  const existing = await prisma.eventParticipation.findUnique({
    where: { userId_eventId: { userId: input.userId, eventId: input.eventId } },
    select: { id: true },
  });
  if (existing) return;

  await prisma.eventParticipation.create({
    data: {
      userId: input.userId,
      eventId: input.eventId,
      notes: input.notes?.trim() || null,
      controlledTireLabel: input.controlledTireLabel?.trim() || null,
      controlledTireTypeId: input.controlledTireTypeId?.trim() || null,
      controlledAdditiveTypeId: input.controlledAdditiveTypeId?.trim() || null,
    },
  });
}

/** True if the user has a participation row or at least one run on this event. */
export async function userCanAccessEvent(userId: string, eventId: string): Promise<boolean> {
  const [part, run] = await Promise.all([
    prisma.eventParticipation.findUnique({
      where: { userId_eventId: { userId, eventId } },
      select: { id: true },
    }),
    prisma.run.findFirst({
      where: { userId, eventId },
      select: { id: true },
    }),
  ]);
  return Boolean(part || run);
}

/** Event ids the user participates in or has logged runs for. */
export async function eventIdsInScopeForUser(userId: string): Promise<string[]> {
  const [participations, runRows] = await Promise.all([
    prisma.eventParticipation.findMany({
      where: { userId },
      select: { eventId: true },
    }),
    prisma.run.findMany({
      where: { userId, eventId: { not: null } },
      distinct: ["eventId"],
      select: { eventId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const p of participations) ids.add(p.eventId);
  for (const r of runRows) {
    if (r.eventId) ids.add(r.eventId);
  }
  return [...ids];
}

export type EventWithUserParticipation = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  trackId: string | null;
  trackNameSnapshot: string | null;
  trackLocationSnapshot: string | null;
  practiceSourceUrl: string | null;
  resultsSourceUrl: string | null;
  raceClass: string | null;
  track: { id: string; name: string; location: string | null } | null;
  /** Current user's participation, if any. */
  myParticipation: {
    notes: string | null;
    controlledTireLabel: string | null;
    controlledTireTypeId: string | null;
    controlledTireType: { id: string; displayName: string; modelCode: string } | null;
    controlledAdditiveTypeId: string | null;
    controlledAdditiveType: { id: string; displayName: string; modelCode: string } | null;
    pinnedAt: Date | null;
  } | null;
};

export function participationForUser<
  T extends {
    userId: string;
    notes: string | null;
    controlledTireLabel: string | null;
    controlledTireTypeId: string | null;
    pinnedAt: Date | null;
    controlledTireType: { id: string; displayName: string; modelCode: string } | null;
    controlledAdditiveTypeId: string | null;
    controlledAdditiveType: { id: string; displayName: string; modelCode: string } | null;
  },
>(participations: T[], userId: string): T | null {
  return participations.find((p) => p.userId === userId) ?? null;
}

/** Shape API / UI list rows with per-user fields lifted from participation. */
export function mapEventForUser<
  E extends {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    trackId: string | null;
    trackNameSnapshot: string | null;
    trackLocationSnapshot: string | null;
    legacyTrackJson?: unknown;
    practiceSourceUrl: string | null;
    resultsSourceUrl: string | null;
    raceClass: string | null;
    track: { id: string; name: string; location: string | null } | null;
    participations: Array<{
      userId: string;
      notes: string | null;
      controlledTireLabel: string | null;
      controlledTireTypeId: string | null;
      pinnedAt: Date | null;
      controlledTireType: { id: string; displayName: string; modelCode: string } | null;
      controlledAdditiveTypeId: string | null;
      controlledAdditiveType: { id: string; displayName: string; modelCode: string } | null;
    }>;
  },
>(event: E, userId: string) {
  const mine = participationForUser(event.participations, userId);
  const { participations: _p, legacyTrackJson: _legacy, ...rest } = event;
  return {
    ...rest,
    trackLabel: resolveEventTrackLabel(event),
    isLegacyTrack: isLegacyEventTrack(event),
    notes: mine?.notes ?? null,
    controlledTireLabel: mine?.controlledTireLabel ?? null,
    controlledTireTypeId: mine?.controlledTireTypeId ?? null,
    controlledTireType: mine?.controlledTireType ?? null,
    controlledAdditiveTypeId: mine?.controlledAdditiveTypeId ?? null,
    controlledAdditiveType: mine?.controlledAdditiveType ?? null,
    pinnedAt: mine?.pinnedAt ?? null,
    hasLiveRcLink: Boolean(event.resultsSourceUrl?.trim() || event.practiceSourceUrl?.trim()),
  };
}

/** User-scoped events with per-user run counts (for dashboard / lists). */
export async function loadUserScopedEvents(input: {
  userId: string;
  take?: number;
}): Promise<
  Array<
    ReturnType<typeof mapEventForUser> & {
      startDate: Date;
      endDate: Date;
      runCount: number;
    }
  >
> {
  const scopedIds = await eventIdsInScopeForUser(input.userId);
  if (scopedIds.length === 0) return [];

  const [events, runCounts] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: scopedIds } },
      orderBy: { startDate: "desc" },
      take: input.take ?? 40,
      include: EVENT_LIST_INCLUDE,
    }),
    prisma.run.groupBy({
      by: ["eventId"],
      where: { userId: input.userId, eventId: { in: scopedIds } },
      _count: { _all: true },
    }),
  ]);

  const countByEvent = new Map(
    runCounts.map((row) => [row.eventId, row._count._all])
  );

  return events.map((event) => ({
    ...mapEventForUser(event, input.userId),
    startDate: event.startDate,
    endDate: event.endDate,
    runCount: countByEvent.get(event.id) ?? 0,
  }));
}
