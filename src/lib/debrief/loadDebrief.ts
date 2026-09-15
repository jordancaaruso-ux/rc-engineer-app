import { prisma } from "@/lib/prisma";
import type { DebriefIdentity } from "@/lib/debrief/debriefKey";

export type DebriefRow = {
  /** The key the row is stored under — may differ from the group's when the group re-keyed. */
  meetingKey: string;
  text: string;
  updatedAtIso: string;
};

type StoredDebrief = {
  id: string;
  meetingKey: string;
  eventId: string | null;
  localDayKey: string;
  trackKey: string;
  text: string;
  updatedAt: Date;
};

const STORED_SELECT = {
  id: true,
  meetingKey: true,
  eventId: true,
  localDayKey: true,
  trackKey: true,
  text: true,
  updatedAt: true,
} as const;

/**
 * The stored row a meeting identity points at, by falling trust: the exact key, then the
 * event, then the driver's day at that track. The fallbacks are what keep a note attached when
 * its group changes key (see `DebriefIdentity`).
 */
function matchIdentity(rows: StoredDebrief[], identity: DebriefIdentity): StoredDebrief | null {
  return (
    rows.find((r) => r.meetingKey === identity.meetingKey) ??
    (identity.eventId ? rows.find((r) => r.eventId === identity.eventId) : undefined) ??
    rows.find(
      (r) => r.localDayKey === identity.localDayKey && r.trackKey === identity.trackKey
    ) ??
    null
  );
}

/**
 * Every debrief the viewer wrote for these meetings, keyed by the meeting's CURRENT key. One
 * query for the whole Sessions page. Always scoped to `userId`: a debrief is the driver's own,
 * never a teammate's.
 */
export async function loadDebriefsForIdentities(
  userId: string,
  identities: readonly DebriefIdentity[]
): Promise<Map<string, DebriefRow>> {
  const out = new Map<string, DebriefRow>();
  if (identities.length === 0) return out;
  const meetingKeys = identities.map((i) => i.meetingKey);
  const eventIds = identities.map((i) => i.eventId).filter((id): id is string => id != null);
  const localDayKeys = [...new Set(identities.map((i) => i.localDayKey))];
  const rows = await prisma.meetingDebrief.findMany({
    where: {
      userId,
      OR: [
        { meetingKey: { in: meetingKeys } },
        ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
        { localDayKey: { in: localDayKeys } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: STORED_SELECT,
  });
  for (const identity of identities) {
    const hit = matchIdentity(rows, identity);
    if (hit) {
      out.set(identity.meetingKey, {
        meetingKey: hit.meetingKey,
        text: hit.text,
        updatedAtIso: hit.updatedAt.toISOString(),
      });
    }
  }
  return out;
}

/**
 * Write the note for one meeting. Null text deletes the row — an emptied box is "nothing to
 * say", not a blank note. A row found through a fallback (old key) is re-keyed to the current
 * identity rather than duplicated, so the unique (user, key) pair stays one note per meeting.
 */
export async function saveDebrief(
  userId: string,
  identity: DebriefIdentity,
  text: string | null
): Promise<{ text: string; updatedAtIso: string } | null> {
  const candidates = await prisma.meetingDebrief.findMany({
    where: {
      userId,
      OR: [
        { meetingKey: identity.meetingKey },
        ...(identity.eventId ? [{ eventId: identity.eventId }] : []),
        { localDayKey: identity.localDayKey, trackKey: identity.trackKey },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: STORED_SELECT,
  });
  const existing = matchIdentity(candidates, identity);

  if (text == null) {
    if (existing) await prisma.meetingDebrief.deleteMany({ where: { id: existing.id, userId } });
    return null;
  }

  const data = {
    meetingKey: identity.meetingKey,
    eventId: identity.eventId,
    localDayKey: identity.localDayKey,
    trackKey: identity.trackKey,
    text,
  };
  const saved = existing
    ? await prisma.meetingDebrief.update({
        where: { id: existing.id },
        data,
        select: { text: true, updatedAt: true },
      })
    : await prisma.meetingDebrief.create({
        data: { userId, ...data },
        select: { text: true, updatedAt: true },
      });
  return { text: saved.text, updatedAtIso: saved.updatedAt.toISOString() };
}
