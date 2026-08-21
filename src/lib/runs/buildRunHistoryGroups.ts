import { formatGroupDate } from "@/lib/formatDate";

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
function trackKey(run: RunForHistoryGroup): string {
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
 * 1-based position of each run within its (user, local calendar day), in
 * time-logged order (`sortAt`, matching group display order). Names unlabeled
 * testing runs — `formatRunSessionDisplay(run, { dayRunNumber })` → "Run 2" —
 * instead of the bare "—" fallback. Plain object so it can cross the
 * server → client component boundary.
 */
export function buildDayRunNumberMap(
  runs: Array<
    Pick<RunForHistoryGroup, "id" | "createdAt" | "sortAt" | "localTimeZone"> & {
      userId?: string | null;
    }
  >,
  timeZone?: string | null,
  opts?: Pick<RunGroupZoneOptions, "ownerTimeZoneByUserId">
): Record<string, number> {
  const zones: RunGroupZoneOptions = { ...opts, viewerTimeZone: timeZone };
  const byDay = new Map<string, Array<{ id: string; t: number }>>();
  for (const run of runs) {
    const instant = runSessionSortInstant(run);
    const key = `${run.userId ?? ""}|${dateKey(instant, resolveRunLocalTimeZone(run, zones))}`;
    const list = byDay.get(key) ?? [];
    list.push({ id: run.id, t: instant.getTime() });
    byDay.set(key, list);
  }
  const map: Record<string, number> = {};
  for (const list of byDay.values()) {
    list.sort((a, b) => a.t - b.t);
    list.forEach((r, i) => {
      map[r.id] = i + 1;
    });
  }
  return map;
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

export function buildRunHistoryGroups<T extends RunForHistoryGroup>(
  runs: T[],
  timeZone?: string | null,
  opts?: Pick<RunGroupZoneOptions, "ownerTimeZoneByUserId">
): RunHistoryGroup<T>[] {
  const zones: RunGroupZoneOptions = { ...opts, viewerTimeZone: timeZone };
  const byKey = new Map<string, T[]>();
  for (const run of runs) {
    const key = sessionGroupKey(run, zones);
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }
  const groups: RunHistoryGroup<T>[] = [];
  for (const [groupKey, groupRuns] of byKey) {
    const run = groupRuns[0]!;
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
          const start = run.event.startDate ? new Date(run.event.startDate) : runSessionSortInstant(run);
          const end = run.event.endDate ? new Date(run.event.endDate) : runSessionSortInstant(run);
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
