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

function dateKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function runSessionSortInstant(run: RunForHistoryGroup): Date {
  const s = run.sortAt ?? run.createdAt;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(run.createdAt) : d;
}

export function buildRunHistoryGroups<T extends RunForHistoryGroup>(
  runs: T[]
): RunHistoryGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const run of runs) {
    const key = run.eventId ? `event-${run.eventId}` : `day-${dateKey(runSessionSortInstant(run))}`;
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
      : `Test day – ${formatGroupDate(runSessionSortInstant(run))}`;
    const type: RunHistoryGroup["type"] = isEvent ? "Race Meeting" : "Testing";
    const trackName = isEvent && run.event
      ? (run.event.track?.name ?? run.event.trackNameSnapshot ?? run.track?.name ?? run.trackNameSnapshot ?? "—")
      : (run.track?.name ?? run.trackNameSnapshot ?? "—");
    const dateLabel = isEvent && run.event
      ? (() => {
          const start = run.event.startDate ? new Date(run.event.startDate) : runSessionSortInstant(run);
          const end = run.event.endDate ? new Date(run.event.endDate) : runSessionSortInstant(run);
          if (dateKey(start) === dateKey(end)) return formatGroupDate(start);
          return `${formatGroupDate(start)} – ${formatGroupDate(end)}`;
        })()
      : formatGroupDate(runSessionSortInstant(run));
    groups.push({
      id: run.eventId ? `event-${run.eventId}` : `day-${dateKey(runSessionSortInstant(run))}`,
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
