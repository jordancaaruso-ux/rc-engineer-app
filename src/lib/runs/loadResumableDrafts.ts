import { prisma } from "@/lib/prisma";
import { startOfDayInTimeZone, todayBoundsInTimeZone } from "@/lib/eventActive";
import {
  DRAFT_DASHBOARD_DAYS,
  rankResumableDrafts,
  type DraftRunCandidate,
  type RankedDraftRun,
} from "@/lib/runs/resumableDraftLogic";

/**
 * The unfinished runs the dashboard should offer, best first.
 *
 * Date-bounded on purpose: `resumableDraftLogic` holds the three-day rule and the reasoning, and
 * is where to change it. This file only has to make sure the query cannot hide a row the rule
 * would have kept — so it asks for a day either side of both edges and lets the rule do the exact
 * comparison in the driver's zone.
 *
 * Nothing here deletes. An older draft is still in the database and still listed in run history;
 * it has only stopped competing for the front page.
 *
 * Replaced `lib/todayDraftRun.ts`. `take` is a rendering cap on top of the window, not the rule.
 */

export type ResumableDraft = {
  id: string;
  /** ISO instant the draft was first saved (run `createdAt`). */
  savedAt: string;
  carName: string | null;
  trackName: string | null;
  eventName: string | null;
  isForToday: boolean;
};

const DRAFT_SELECT = {
  id: true,
  createdAt: true,
  carNameSnapshot: true,
  car: { select: { name: true } },
  trackNameSnapshot: true,
  track: { select: { name: true } },
  event: { select: { id: true, name: true, startDate: true, endDate: true } },
} as const;

type DraftRow = {
  id: string;
  createdAt: Date;
  carNameSnapshot: string | null;
  car: { name: string } | null;
  trackNameSnapshot: string | null;
  track: { name: string } | null;
  event: { id: string; name: string; startDate: Date; endDate: Date } | null;
};

type DraftCandidateRow = DraftRow & DraftRunCandidate;

const DAY_MS = 24 * 60 * 60 * 1000;

function toResumableDraft(row: RankedDraftRun<DraftCandidateRow>): ResumableDraft {
  return {
    id: row.id,
    savedAt: row.createdAt.toISOString(),
    // Snapshot first: it survives the car or track row being deleted, which is the whole
    // reason both columns exist.
    carName: row.car?.name ?? row.carNameSnapshot ?? null,
    trackName: row.track?.name ?? row.trackNameSnapshot ?? null,
    eventName: row.event?.name ?? null,
    isForToday: row.isForToday,
  };
}

export async function loadResumableDrafts(
  userId: string,
  timeZone: string,
  opts?: { take?: number; now?: Date }
): Promise<ResumableDraft[]> {
  const now = opts?.now ?? new Date();
  const { start: todayStart, end: todayEnd } = todayBoundsInTimeZone(timeZone, now);

  /*
   * Local midnight (DRAFT_DASHBOARD_DAYS - 1) days back. Stepping in whole days from today's
   * midnight and re-snapping keeps a DST week honest; on the one fall-back night a year it can
   * land a day early, which shows one extra draft rather than hiding one.
   */
  const windowStart = startOfDayInTimeZone(
    timeZone,
    new Date(todayStart.getTime() - (DRAFT_DASHBOARD_DAYS - 1) * DAY_MS)
  );

  const rows = (await prisma.run.findMany({
    where: {
      userId,
      loggingComplete: false,
      OR: [
        { createdAt: { gte: windowStart } },
        // A draft banked well ahead for a meeting that is running today. Event dates are calendar
        // days pinned to UTC noon, so this is deliberately loose by a day at each end — the exact
        // "is it on today" comparison happens in the driver's zone in `rankResumableDrafts`.
        {
          event: {
            startDate: { lte: new Date(todayEnd.getTime() + DAY_MS) },
            endDate: { gte: new Date(todayStart.getTime() - DAY_MS) },
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 25,
    select: DRAFT_SELECT,
  })) as DraftRow[];

  if (rows.length === 0) return [];

  const ranked = rankResumableDrafts({
    candidates: rows.map((r) => ({
      ...r,
      savedAt: r.createdAt,
      eventId: r.event?.id ?? null,
      eventName: r.event?.name ?? null,
      eventStartDate: r.event?.startDate ?? null,
      eventEndDate: r.event?.endDate ?? null,
    })),
    referenceDate: now,
    timeZone,
  });

  return ranked.map(toResumableDraft);
}

/** The single draft a resume bar should offer, or null. */
export async function getResumableDraft(
  userId: string,
  timeZone: string,
  opts?: { now?: Date }
): Promise<ResumableDraft | null> {
  const drafts = await loadResumableDrafts(userId, timeZone, { take: 25, now: opts?.now });
  return drafts[0] ?? null;
}
