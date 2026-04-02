import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting } from "@/lib/appSettings";
import { formatGroupDate } from "@/lib/formatDate";
import { RunHistoryTable } from "@/components/runs/RunHistoryTable";
import { compareRunTimestamp } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import Link from "next/link";

type RunInGroup = Awaited<ReturnType<typeof fetchRuns>>[number];

function dateKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

async function fetchRuns(userId: string) {
  return prisma.run.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      car: { select: { id: true, name: true, setupSheetTemplate: true } },
      track: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      event: { include: { track: { select: { name: true } } } },
      setupSnapshot: { select: { id: true, data: true } },
      importedLapSets: {
        include: {
          laps: { orderBy: { lapNumber: "asc" } },
        },
      },
    },
  });
}

async function backfillRunNameSnapshots(userId: string) {
  // Best-effort, idempotent backfill for older runs created before snapshot fields existed.
  const candidates = await prisma.run.findMany({
    where: {
      userId,
      OR: [
        { carNameSnapshot: null },
        { trackNameSnapshot: null },
      ],
    },
    select: {
      id: true,
      carId: true,
      trackId: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true } },
    },
    take: 500,
  });

  const updates = candidates
    .map((r) => {
      const nextCar = r.carNameSnapshot ?? r.car?.name ?? null;
      const nextTrack = r.trackNameSnapshot ?? r.track?.name ?? null;
      if (nextCar === r.carNameSnapshot && nextTrack === r.trackNameSnapshot) return null;
      return { id: r.id, carNameSnapshot: nextCar, trackNameSnapshot: nextTrack };
    })
    .filter(Boolean) as Array<{ id: string; carNameSnapshot: string | null; trackNameSnapshot: string | null }>;

  for (const u of updates) {
    await prisma.run.update({
      where: { id: u.id },
      data: { carNameSnapshot: u.carNameSnapshot, trackNameSnapshot: u.trackNameSnapshot },
    });
  }
}

type Group = {
  id: string;
  title: string;
  type: "Testing" | "Race Meeting";
  trackName: string | null;
  dateLabel: string;
  runs: RunInGroup[];
};

function buildGroups(runs: RunInGroup[]): Group[] {
  const byKey = new Map<string, RunInGroup[]>();
  for (const run of runs) {
    const key = run.eventId ? `event-${run.eventId}` : `day-${dateKey(run.createdAt)}`;
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }
  const groups: Group[] = [];
  for (const [key, groupRuns] of byKey) {
    const run = groupRuns[0];
    const isEvent = !!run.eventId && run.event;
    const title = isEvent && run.event
      ? run.event.name
      : `Test day – ${formatGroupDate(run.createdAt)}`;
    const type: Group["type"] = isEvent ? "Race Meeting" : "Testing";
    const trackName = isEvent && run.event
      ? (run.event.track?.name ?? run.track?.name ?? run.trackNameSnapshot ?? "—")
      : (run.track?.name ?? run.trackNameSnapshot ?? "—");
    const dateLabel = isEvent && run.event
      ? (() => {
          const start = run.event.startDate ? new Date(run.event.startDate) : new Date(run.createdAt);
          const end = run.event.endDate ? new Date(run.event.endDate) : new Date(run.createdAt);
          if (dateKey(start) === dateKey(end)) return formatGroupDate(start);
          return `${formatGroupDate(start)} – ${formatGroupDate(end)}`;
        })()
      : formatGroupDate(run.createdAt);
    groups.push({
      id: key,
      title,
      type,
      trackName,
      dateLabel,
      runs: groupRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    });
  }
  groups.sort((a, b) => {
    const aMax = Math.max(...a.runs.map((r) => new Date(r.createdAt).getTime()));
    const bMax = Math.max(...b.runs.map((r) => new Date(r.createdAt).getTime()));
    return bMax - aMax;
  });
  return groups;
}

export default async function RunHistoryPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Analysis</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view run history.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  await backfillRunNameSnapshots(user.id);
  const userDisplayName = await getMyNameSetting(user.id);
  const runs = await fetchRuns(user.id);
  const groups = buildGroups(runs);
  const allRunsDescending = [...runs].sort(compareRunTimestamp);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Analysis</h1>
          <p className="page-subtitle">
            Review runs and compare to your working setup or another run. Load past setups from Log your run.
          </p>
        </div>
        <Link
          href="/runs/new"
          className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition"
        >
          Log your run
        </Link>
      </header>
      <section className="page-body space-y-3">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No runs yet. <Link href="/runs/new" className="text-accent underline">Create your first run</Link>.
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <details
                key={group.id}
                className="rounded-lg border border-border bg-muted/50 overflow-hidden group/details"
                open={false}
              >
                <summary className="list-none cursor-pointer">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50 transition">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-sm">{group.title}</span>
                      <span className="text-xs text-muted-foreground">{group.type}</span>
                      {group.trackName && (
                        <span className="text-xs text-muted-foreground">· {group.trackName}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{group.dateLabel}</span>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground tabular-nums">
                      {group.runs.length} run{group.runs.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </summary>
                <div className="border-t border-border bg-muted/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/70 text-left text-xs font-medium text-muted-foreground">
                          <th className="px-4 py-2">Date</th>
                          <th className="px-4 py-2">Car</th>
                          <th className="px-4 py-2">Track</th>
                          <th className="px-4 py-2">Tires</th>
                          <th className="px-4 py-2">Best</th>
                          <th className="px-4 py-2">Avg top 5</th>
                          <th className="px-4 py-2">Session</th>
                        </tr>
                      </thead>
                      <tbody>
                        <RunHistoryTable
                          runs={group.runs}
                          allRunsDescending={allRunsDescending.map(toCompareRunShape)}
                          userDisplayName={userDisplayName}
                        />
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
