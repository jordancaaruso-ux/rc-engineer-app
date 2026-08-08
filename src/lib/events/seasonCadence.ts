/**
 * The cadence read — what the Events page says in the "Next up" slot when nothing is
 * booked, which is the founder's own state (16 events logged, 0 upcoming).
 *
 * It reads the racing rhythm out of logged events and names it, then offers the date that
 * rhythm implies: "You've raced Boronia 5 of the last 6 Saturdays." "No upcoming events"
 * would be true and useless; this is the same fact turned into a reason to book.
 *
 * Pure — no Prisma, no React — because this is the one sentence on the page the app writes
 * rather than measures, and it gets read at the track. It has to be checkable against a
 * calendar in a unit test.
 */
import type { SeasonEventRow } from "@/lib/events/seasonEventRow";

/** How many past occurrences of a weekday the claim looks back over. */
const CADENCE_WINDOW = 6;

/** Beyond this, a run of club days is history rather than a claim about this Saturday. */
const CADENCE_RECENCY_DAYS = 120;

/** Two hits in the window is the floor — one visit is not a rhythm. */
const CADENCE_MIN_HITS = 2;

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type CadenceRead = {
  /** e.g. "You've raced Boronia 5 of the last 6 Saturdays." */
  headline: string;
  /** The next occurrence of that slot, `YYYY-MM-DD` — prefills the new-event form. */
  suggestedYmd: string | null;
  suggestedLabel: string | null;
  lastOut: { name: string; trackName: string | null; ymd: string; daysAgo: number } | null;
};

/* Event dates are stored at UTC noon, so all of this is UTC. Local getters would shift a
   weekday by one for anyone east of GMT — which is everyone this app has. */

function utcOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((utcOf(toYmd).getTime() - utcOf(fromYmd).getTime()) / 86_400_000);
}

export function addDays(ymd: string, n: number): string {
  return new Date(utcOf(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export function buildCadenceRead(allEvents: SeasonEventRow[], todayYmd: string): CadenceRead {
  const past = allEvents
    .filter((e) => e.status === "logged")
    .sort((a, b) => b.startYmd.localeCompare(a.startYmd));

  const mostRecent = past[0];
  const lastOut = mostRecent
    ? {
        name: mostRecent.name,
        trackName: mostRecent.trackName,
        ymd: mostRecent.startYmd,
        daysAgo: daysBetween(mostRecent.startYmd, todayYmd),
      }
    : null;

  const recent = past.filter((e) => daysBetween(e.startYmd, todayYmd) <= CADENCE_RECENCY_DAYS);
  const todayDow = utcOf(todayYmd).getUTCDay();

  let best: { hits: number; headline: string; ymd: string; label: string } | null = null;

  const byTrack = new Map<string, SeasonEventRow[]>();
  for (const e of recent) {
    if (!e.trackId) continue;
    const list = byTrack.get(e.trackId);
    if (list) list.push(e);
    else byTrack.set(e.trackId, [e]);
  }

  for (const list of byTrack.values()) {
    const byWeekday = new Map<number, SeasonEventRow[]>();
    for (const e of list) {
      const dow = utcOf(e.startYmd).getUTCDay();
      const hits = byWeekday.get(dow);
      if (hits) hits.push(e);
      else byWeekday.set(dow, [e]);
    }

    for (const [dow, hits] of byWeekday) {
      // The window ends on the most recent occurrence of this weekday that has already
      // happened. When today IS that weekday, today does not count as "been" — the driver
      // is looking at this card instead of being at the track.
      const back = (todayDow - dow + 7) % 7;
      const lastOccurrence = addDays(todayYmd, -(back === 0 ? 7 : back));
      const windowStart = addDays(lastOccurrence, -7 * (CADENCE_WINDOW - 1));
      const inWindow = hits.filter(
        (e) => e.startYmd >= windowStart && e.startYmd <= lastOccurrence
      );
      if (inWindow.length < CADENCE_MIN_HITS) continue;
      if (best && inWindow.length <= best.hits) continue;

      const nextYmd = addDays(lastOccurrence, 7);
      best = {
        hits: inWindow.length,
        headline: `You've raced ${hits[0]!.trackName ?? "the same track"} ${inWindow.length} of the last ${CADENCE_WINDOW} ${WEEKDAY[dow]}s.`,
        ymd: nextYmd,
        label: `${WEEKDAY[dow]} ${shortDate(nextYmd)}`,
      };
    }
  }

  if (best) {
    return {
      headline: best.headline,
      suggestedYmd: best.ymd,
      suggestedLabel: best.label,
      lastOut,
    };
  }

  return {
    headline: lastOut
      ? `Your last day out was ${lastOut.trackName ?? lastOut.name}, ${lastOut.daysAgo} ${
          lastOut.daysAgo === 1 ? "day" : "days"
        } ago.`
      : "No meetings logged yet.",
    suggestedYmd: null,
    suggestedLabel: null,
    lastOut,
  };
}

function shortDate(ymd: string): string {
  const d = utcOf(ymd);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}
