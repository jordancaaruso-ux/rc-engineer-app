import { formatGroupDate } from "@/lib/formatDate";

export type RunForHistoryGroup = {
  id: string;
  createdAt: Date;
  sortAt: Date | null;
  eventId: string | null;
  trackNameSnapshot: string | null;
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
  type: "Testing" | "Race Meeting";
  trackName: string | null;
  dateLabel: string;
  runs: T[];
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

export function runSessionSortInstant(run: RunForHistoryGroup): Date {
  const s = run.sortAt ?? run.createdAt;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(run.createdAt) : d;
}

export function buildRunHistoryGroups<T extends RunForHistoryGroup>(
  runs: T[],
  timeZone?: string | null
): RunHistoryGroup<T>[] {
  // Non-event runs group by day AND track: a single calendar day can span two
  // venues (especially in team view, where teammates run different tracks the
  // same day) — keying on day alone merged them and mislabelled the group with
  // one track. Events keep their own single-venue grouping.
  const byKey = new Map<string, T[]>();
  for (const run of runs) {
    const key = run.eventId
      ? `event-${run.eventId}`
      : `day-${dateKey(runSessionSortInstant(run), timeZone)}-${trackKey(run)}`;
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }
  const groups: RunHistoryGroup<T>[] = [];
  for (const [, groupRuns] of byKey) {
    const run = groupRuns[0]!;
    const isEvent = !!run.eventId && run.event;
    const title = isEvent && run.event
      ? run.event.name
      : `Test day – ${formatGroupDate(runSessionSortInstant(run), timeZone)}`;
    const type: RunHistoryGroup["type"] = isEvent ? "Race Meeting" : "Testing";
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
      : formatGroupDate(runSessionSortInstant(run), timeZone);
    groups.push({
      id: run.eventId
        ? `event-${run.eventId}`
        : `day-${dateKey(runSessionSortInstant(run), timeZone)}-${trackKey(run)}`,
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
