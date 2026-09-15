import { formatGroupDate } from "@/lib/formatDate";
import { formatRunSessionDisplay, resolveDayRunNames } from "@/lib/runSession";

export type RunForHistoryGroup = {
  id: string;
  createdAt: Date;
  sortAt: Date | null;
  eventId: string | null;
  trackNameSnapshot: string | null;
  /** Zone of the device that logged this run; null on runs predating the column. */
  localTimeZone?: string | null;
  /** Owner of the run — the driver, who may not be the viewer in team Sessions. */
  userId?: string | null;
  track?: { name: string } | null;
  event?: {
    name: string;
    startDate: Date | null;
    endDate: Date | null;
    trackNameSnapshot?: string | null;
    track?: { name: string } | null;
  } | null;
};

export type RunHistoryGroup<T extends RunForHistoryGroup = RunForHistoryGroup> = {
  id: string;
  title: string;
  type: "Testing" | "Event";
  trackName: string | null;
  dateLabel: string;
  runs: T[];
};

/**
 * Zone a run's calendar day should be resolved in: the driver's, never the reader's.
 *
 * Keyed on the viewer's zone, a teammate's continuous test day splits into two dated
 * groups the moment it crosses the viewer's midnight — which is exactly how one MR33
 * Arena test day came to show as both 06 and 07 Aug (reported 2026-08-09). Runs carry
 * the logging device's zone from 2026-08-09; older runs fall back to the last zone seen
 * on the owner's account, and only then to the reader's.
 */
export function resolveRunLocalTimeZone(
  run: Pick<RunForHistoryGroup, "localTimeZone" | "userId">,
  opts?: RunGroupZoneOptions
): string | null {
  if (run.localTimeZone) return run.localTimeZone;
  const owner = run.userId ? opts?.ownerTimeZoneByUserId?.[run.userId] : null;
  if (owner) return owner;
  return opts?.viewerTimeZone ?? null;
}

export type RunGroupZoneOptions = {
  /** `User.timeZone` per driver — the fallback for runs logged before per-run capture. */
  ownerTimeZoneByUserId?: Record<string, string | null | undefined>;
  /** Reader's own zone; last resort only, and the reason days used to split. */
  viewerTimeZone?: string | null;
};

/**
 * Calendar day (YYYY-MM-DD) for grouping. With a `timeZone` the day is resolved
 * in that zone so a run near UTC midnight groups under the same local day its
 * label shows; without one it falls back to UTC. `en-CA` yields ISO order.
 */
function dateKey(d: Date, timeZone?: string | null): string {
  if (timeZone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(d));
  }
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Per-run track identity for grouping. Keyed on the resolved track *name*, not
 * the id: legacy/imported runs often carry only a `trackNameSnapshot` with a
 * null `trackId`, so id-keying would split the same venue (e.g. one "TFTR" day)
 * into two groups. Same-named tracks are the same session location here.
 */
export function trackKey(run: RunForHistoryGroup): string {
  const name = (run.track?.name ?? run.trackNameSnapshot ?? "").trim().toLowerCase();
  return name ? `name:${name}` : "no-track";
}

export function runSessionSortInstant(
  run: Pick<RunForHistoryGroup, "createdAt" | "sortAt">
): Date {
  const s = run.sortAt ?? run.createdAt;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(run.createdAt) : d;
}

/**
 * The NAME each run shows in the list, resolved against the rest of its day.
 *
 * An unlabeled testing run is named by its 1-based position within its (user, local
 * calendar day), in time-logged order (`sortAt`, matching group display order) —
 * "Run 2" instead of the bare "—" fallback.
 *
 * A session is named by its type and nothing stores a session number, so a day of five
 * practice sessions listed five rows all reading "Practice". Where a name repeats inside
 * one day it says nothing, and `resolveDayRunNames` swaps it for the run's position —
 * "Run 3" — rather than inventing a session number the event's timetable may contradict.
 *
 * Plain object so it can cross the server → client component boundary, same as the
 * number map above.
 */
export function buildDayRunNameMap(
  runs: Array<
    Pick<RunForHistoryGroup, "id" | "createdAt" | "sortAt" | "localTimeZone"> & {
      userId?: string | null;
      sessionType: string;
      meetingSessionType?: string | null;
      meetingSessionCode?: string | null;
      sessionLabel?: string | null;
    }
  >,
  timeZone?: string | null,
  opts?: Pick<RunGroupZoneOptions, "ownerTimeZoneByUserId">
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const day of groupRunsByDay(runs, timeZone, opts)) {
    const named = resolveDayRunNames(
      day.map((run, i) => ({
        name: formatRunSessionDisplay(run, { dayRunNumber: i + 1 }),
        dayRunNumber: i + 1,
      }))
    );
    day.forEach((run, i) => {
      map[run.id] = named[i].label;
    });
  }
  return map;
}

/**
 * Today's runs split into (owner, local calendar day) buckets, each in time-logged
 * order (`sortAt`, matching group display order). Shared so the number map and the
 * name map above can never disagree about which runs are in the same day.
 */
function groupRunsByDay<
  T extends Pick<RunForHistoryGroup, "id" | "createdAt" | "sortAt" | "localTimeZone"> & {
    userId?: string | null;
  },
>(
  runs: readonly T[],
  timeZone?: string | null,
  opts?: Pick<RunGroupZoneOptions, "ownerTimeZoneByUserId">
): T[][] {
  const zones: RunGroupZoneOptions = { ...opts, viewerTimeZone: timeZone };
  const byDay = new Map<string, Array<{ run: T; t: number }>>();
  for (const run of runs) {
    const instant = runSessionSortInstant(run);
    const key = `${run.userId ?? ""}|${dateKey(instant, resolveRunLocalTimeZone(run, zones))}`;
    const list = byDay.get(key) ?? [];
    list.push({ run, t: instant.getTime() });
    byDay.set(key, list);
  }
  return [...byDay.values()].map((list) =>
    list.sort((a, b) => a.t - b.t).map((entry) => entry.run)
  );
}

/**
 * The session a run belongs to, as a stable key.
 *
 * Non-event runs group by day AND track: a single calendar day can span two
 * venues (especially in team view, where teammates run different tracks the
 * same day) — keying on day alone merged them and mislabelled the group with
 * one track. Events keep their own single-venue grouping.
 *
 * The day is resolved in the DRIVER's zone (see `resolveRunLocalTimeZone`), so the
 * same key comes out no matter who is reading the list.
 *
 * Exported because the Sessions workbench counts a session's *unfiltered* runs from
 * a separate, minimal query — if that side keyed sessions differently, "2 of 8" would
 * be counting a different set of runs than the one on screen.
 */
export function sessionGroupKey(
  run: RunForHistoryGroup,
  zones?: RunGroupZoneOptions
): string {
  return run.eventId
    ? `event-${run.eventId}`
    : `day-${dateKey(runSessionSortInstant(run), resolveRunLocalTimeZone(run, zones))}-${trackKey(run)}`;
}

/**
 * The calendar day a run belongs to (YYYY-MM-DD), resolved in the DRIVER's zone —
 * the same rule `sessionGroupKey` uses to decide which day a testing run lands in.
 * Exported because the team-day chart has to split a multi-day meeting on exactly
 * that boundary; a second day rule there would put a run in one day on the list
 * and the next day on the chart.
 */
export function runLocalDayKey(
  run: {
    createdAt: Date | string;
    sortAt?: Date | string | null;
    localTimeZone?: string | null;
    userId?: string | null;
  },
  zones?: RunGroupZoneOptions
): string {
  const instant = runSessionSortInstant({
    createdAt: new Date(run.createdAt),
    sortAt: run.sortAt ? new Date(run.sortAt) : null,
  });
  return dateKey(instant, resolveRunLocalTimeZone(run, zones));
}

/**
 * "Fri 26 Jun" from a YYYY-MM-DD day key. The key is already in the driver's zone, so it
 * is formatted at UTC noon — anything else re-applies a zone shift to a date that has
 * already had one and can slide the label to the wrong day. One formatter for every
 * surface that names a day inside a meeting (the team chart's bands, the day bands on the
 * pace chart, the day dividers in a run list), so they cannot spell one Saturday two ways.
 */
export function formatRunDayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Whole calendar days between two YYYY-MM-DD keys; 1 means they touch. */
export function dayKeyDistance(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`));
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : Math.round(ms / 86_400_000);
}

/** Longest declared event a fold will walk day by day; anything longer is a data error. */
const MAX_EVENT_FOLD_DAYS = 14;

/** Every calendar day (YYYY-MM-DD) an event declares, first to last. */
function eventDeclaredDays(event: RunForHistoryGroup["event"]): string[] {
  if (!event?.startDate || !event.endDate) return [];
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const days: string[] = [];
  for (let i = 0; i < MAX_EVENT_FOLD_DAYS; i += 1) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i, 12)
    );
    if (d.getTime() > end.getTime() + 12 * 60 * 60 * 1000) break;
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The session key of every run in a list, with eventless runs folded into the meeting they
 * were obviously at.
 *
 * Founder ruling (2026-09-06): *"even if a user logs runs separately not under an event, but
 * they're at the same track, it should appear under the same results as someone on an event
 * at the same day — it'll obviously be the same meeting."* Before this, a teammate who tapped
 * "Not now" on the join prompt sat in a second "Test day" group beside the event, and the
 * team day view split the one meeting in two.
 *
 * The rule: a run with no event, at the same track (by name, as `trackKey` does), on a day the
 * event covers — any day the event declares, or any day one of its runs actually landed on —
 * takes the event's key. Runs on a *different* event never fold: that is someone's own booking
 * with its own name, and merging two named meetings is a dedupe question, not a grouping one.
 * When two events at one track claim the same day, the one with more runs on it wins, and the
 * first seen on a tie, so the answer is stable across reads.
 *
 * ## Touching days fold too (founder ruling, 2026-09-14)
 *
 * A meeting is the run of consecutive days at the track, not only the dates on the entry form.
 * The Friday practice before a Saturday–Sunday title, logged without joining the event, is
 * part of that weekend to the driver — *"yes, fold it in."* So an eventless day at the event's
 * track that TOUCHES a day already in the meeting joins it, and the day it brings can be
 * touched in turn: Thursday reaches a Saturday event through Friday. A gap day breaks the
 * chain — Saturday and Monday are two outings. Capped at `MAX_EVENT_FOLD_DAYS` either way,
 * as the declared range is, so a data error cannot swallow a season.
 *
 * `sessionGroupKey` on its own still gives the unfolded key; this is the one the list and the
 * workbench's "2 of 8" count must both use, or they count different sessions.
 */
export function resolveSessionGroupKeys<T extends RunForHistoryGroup>(
  runs: readonly T[],
  zones?: RunGroupZoneOptions
): Map<string, string> {
  const keyByRunId = new Map<string, string>();
  const eventScopes = new Map<string, { tracks: Set<string>; days: Set<string>; count: number }>();
  for (const run of runs) {
    const key = sessionGroupKey(run, zones);
    keyByRunId.set(run.id, key);
    if (!run.eventId) continue;
    let scope = eventScopes.get(key);
    if (!scope) {
      scope = { tracks: new Set(), days: new Set(), count: 0 };
      eventScopes.set(key, scope);
    }
    scope.count += 1;
    const own = trackKey(run);
    if (own !== "no-track") scope.tracks.add(own);
    const eventTrack = (run.event?.track?.name ?? run.event?.trackNameSnapshot ?? "")
      .trim()
      .toLowerCase();
    if (eventTrack) scope.tracks.add(`name:${eventTrack}`);
    scope.days.add(runLocalDayKey(run, zones));
    for (const day of eventDeclaredDays(run.event)) scope.days.add(day);
  }
  if (eventScopes.size === 0) return keyByRunId;

  // Touching days: an eventless day at one of the meeting's tracks that sits next to a day
  // the meeting already holds joins it, and the chain walks on from there.
  const looseDaysByTrack = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.eventId) continue;
    const track = trackKey(run);
    if (track === "no-track") continue;
    const set = looseDaysByTrack.get(track) ?? new Set<string>();
    set.add(runLocalDayKey(run, zones));
    looseDaysByTrack.set(track, set);
  }
  for (const scope of eventScopes.values()) {
    const candidates = new Set<string>();
    for (const track of scope.tracks) {
      for (const day of looseDaysByTrack.get(track) ?? []) candidates.add(day);
    }
    for (let step = 0; step < MAX_EVENT_FOLD_DAYS; step += 1) {
      let grew = false;
      for (const day of candidates) {
        if (scope.days.has(day)) continue;
        let touches = false;
        for (const held of scope.days) {
          if (dayKeyDistance(day, held) === 1) {
            touches = true;
            break;
          }
        }
        if (touches) {
          scope.days.add(day);
          grew = true;
        }
      }
      if (!grew) break;
    }
  }

  const claim = new Map<string, { key: string; count: number }>();
  for (const [key, scope] of eventScopes) {
    for (const track of scope.tracks) {
      for (const day of scope.days) {
        const at = `${day}|${track}`;
        const current = claim.get(at);
        if (!current || scope.count > current.count) claim.set(at, { key, count: scope.count });
      }
    }
  }
  for (const run of runs) {
    if (run.eventId) continue;
    const track = trackKey(run);
    if (track === "no-track") continue;
    const hit = claim.get(`${runLocalDayKey(run, zones)}|${track}`);
    if (hit) keyByRunId.set(run.id, hit.key);
  }
  return keyByRunId;
}

export function buildRunHistoryGroups<T extends RunForHistoryGroup>(
  runs: T[],
  timeZone?: string | null,
  opts?: Pick<RunGroupZoneOptions, "ownerTimeZoneByUserId">
): RunHistoryGroup<T>[] {
  const zones: RunGroupZoneOptions = { ...opts, viewerTimeZone: timeZone };
  const keyByRunId = resolveSessionGroupKeys(runs, zones);
  const byKey = new Map<string, T[]>();
  for (const run of runs) {
    const key = keyByRunId.get(run.id) ?? sessionGroupKey(run, zones);
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }
  const groups: RunHistoryGroup<T>[] = [];
  for (const [groupKey, groupRuns] of byKey) {
    // A folded group holds eventless runs too; the header must read off one that carries the
    // event, whichever came first in the list.
    const run = groupRuns.find((r) => r.eventId && r.event) ?? groupRuns[0]!;
    const runZone = resolveRunLocalTimeZone(run, zones);
    const isEvent = !!run.eventId && run.event;
    const title = isEvent && run.event
      ? run.event.name
      : `Test day – ${formatGroupDate(runSessionSortInstant(run), runZone)}`;
    const type: RunHistoryGroup["type"] = isEvent ? "Event" : "Testing";
    const trackName = isEvent && run.event
      ? (run.event.track?.name ?? run.event.trackNameSnapshot ?? run.track?.name ?? run.trackNameSnapshot ?? "—")
      : (run.track?.name ?? run.trackNameSnapshot ?? "—");
    const dateLabel = isEvent && run.event
      ? (() => {
          // The declared range, widened to any day a run in the group actually landed on:
          // a folded Friday practice makes a "13 – 14 Sep" meeting a "12 – 14 Sep" one.
          const instants = groupRuns.map((r) => runSessionSortInstant(r).getTime());
          const declaredStart = run.event.startDate ? new Date(run.event.startDate).getTime() : Number.NaN;
          const declaredEnd = run.event.endDate ? new Date(run.event.endDate).getTime() : Number.NaN;
          const start = new Date(Math.min(...instants, ...(Number.isNaN(declaredStart) ? [] : [declaredStart])));
          const end = new Date(Math.max(...instants, ...(Number.isNaN(declaredEnd) ? [] : [declaredEnd])));
          if (dateKey(start) === dateKey(end)) return formatGroupDate(start);
          // Compact shared segments so multi-day ranges stay on one line:
          // "26 – 28 Jun 2026" / "28 Jun – 1 Jul 2026".
          const startLabel = formatGroupDate(start);
          const endLabel = formatGroupDate(end);
          const sameYear = start.getFullYear() === end.getFullYear();
          if (sameYear && start.getMonth() === end.getMonth()) {
            return `${start.getDate()} – ${endLabel}`;
          }
          if (sameYear) {
            return `${startLabel.replace(/\s\d{4}$/, "")} – ${endLabel}`;
          }
          return `${startLabel} – ${endLabel}`;
        })()
      : formatGroupDate(runSessionSortInstant(run), runZone);
    groups.push({
      id: groupKey,
      title,
      type,
      trackName,
      dateLabel,
      runs: groupRuns.sort(
        (a, b) => runSessionSortInstant(b).getTime() - runSessionSortInstant(a).getTime()
      ),
    });
  }
  groups.sort((a, b) => {
    const aMax = Math.max(...a.runs.map((r) => runSessionSortInstant(r).getTime()));
    const bMax = Math.max(...b.runs.map((r) => runSessionSortInstant(r).getTime()));
    return bMax - aMax;
  });
  return groups;
}
