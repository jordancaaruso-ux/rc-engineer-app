import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getMyNameSetting } from "@/lib/appSettings";
import { formatGroupDate } from "@/lib/formatDate";
import { RunHistoryTable } from "@/components/runs/RunHistoryTable";
import { SessionGroupsPager } from "@/components/runs/SessionGroupsPager";
import {
  AnalysisCompareBar,
  AnalysisCompareProvider,
} from "@/components/runs/AnalysisCompareContext";
import { compareRunTimestamp } from "@/lib/runCompareCatalog";
import { toCompareRunShape } from "@/lib/runCompareShape";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import Link from "next/link";

export const dynamic = "force-dynamic";

type RunInGroup = Awaited<ReturnType<typeof fetchRuns>>[number];

function dateKey(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * List-ordering instant. Always reads from `sortAt` (the stable ordering axis
 * stamped once at create, mutated only by explicit user reorder). Falls back
 * to createdAt defensively for rows older than the migration that somehow
 * arrived without a sortAt value — shouldn't happen post-backfill.
 */
function runSessionSortInstant(run: RunInGroup): Date {
  const s = run.sortAt ?? run.createdAt;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(run.createdAt) : d;
}

async function fetchRuns(userId: string) {
  return prisma.run.findMany({
    where: { userId },
    orderBy: { sortAt: "desc" },
    take: 200,
    include: {
      car: { select: { id: true, name: true, setupSheetTemplate: true } },
      track: { select: { id: true, name: true } },
      tireSet: { select: { id: true, label: true, setNumber: true } },
      event: { include: { track: { select: { name: true } } } },
      setupSnapshot: { select: { id: true, data: true } },
      // Nested laps are omitted here — they can be huge and are only needed when
      // the user opens "Analyse lap times" on an expanded row. Loaded on demand via
      // GET /api/runs/[id]/imported-lap-sets.
      importedLapSets: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          sessionCompletedAt: true,
          sourceUrl: true,
          driverId: true,
          driverName: true,
          displayName: true,
          surname: true,
          normalizedName: true,
          isPrimaryUser: true,
        },
      },
    },
  });
}

// NOTE: A one-shot backfill for `carNameSnapshot`/`trackNameSnapshot` used to
// run on every Analysis page load. It has been removed from the request path
// because (a) the UI already falls back to the relations when snapshots are
// missing, and (b) scanning up to 500 rows and issuing N writes per page load
// was the single biggest cause of Analysis feeling slow.
// If old rows ever need patching, call a one-shot migration endpoint — do not
// reintroduce this on render.

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
    const key = run.eventId ? `event-${run.eventId}` : `day-${dateKey(runSessionSortInstant(run))}`;
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
      : `Test day – ${formatGroupDate(runSessionSortInstant(run))}`;
    const type: Group["type"] = isEvent ? "Race Meeting" : "Testing";
    const trackName = isEvent && run.event
      ? (run.event.track?.name ?? run.track?.name ?? run.trackNameSnapshot ?? "—")
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
      id: key,
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

export default async function RunHistoryPage({
  searchParams,
}: {
  // `expandLatest=1` is set when the driver completes a run from the log
  // form. Pre-opens the most recent group so the just-completed run is
  // visible without an extra click.
  searchParams?: Promise<{ expandLatest?: string | string[] }>;
}): Promise<ReactNode> {
  const resolvedSearch = (await searchParams) ?? {};
  const rawExpand = resolvedSearch.expandLatest;
  const expandLatest =
    (Array.isArray(rawExpand) ? rawExpand[0] : rawExpand) === "1";
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Sessions</h1>
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

  const user = await requireCurrentUser();
  const userDisplayName = await getMyNameSetting(user.id);
  const runs = await fetchRuns(user.id);
  const groups = buildGroups(runs);
  const allRunsDescending = [...runs].sort(compareRunTimestamp);
  const initialTargetId = allRunsDescending[0]?.id ?? null;
  const initialCompareId =
    allRunsDescending.length >= 2 ? allRunsDescending[1]?.id ?? null : null;
  const runLabels: Record<string, string> = {};
  for (const r of runs) {
    const car = r.car?.name ?? r.carNameSnapshot ?? "Car";
    const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(r));
    runLabels[r.id] = `${car} · ${when}`;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">
            Review runs and compare to your working setup or another run. Load past setups from Log your run.
          </p>
        </div>
      </header>
      <section className="page-body space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/runs/new"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition"
          >
            Log new run
          </Link>
          <span className="text-[11px] text-muted-foreground">
            {groups.length === 0
              ? "No runs yet."
              : `${runs.length} run${runs.length === 1 ? "" : "s"} across ${groups.length} session${groups.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {groups.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No runs yet. <Link href="/runs/new" className="text-accent underline">Create your first run</Link>.
          </div>
        ) : (
          <AnalysisCompareProvider
            runLabels={runLabels}
            initialTargetId={initialTargetId}
            initialCompareId={
              initialCompareId && initialCompareId !== initialTargetId ? initialCompareId : null
            }
          >
            <AnalysisCompareBar />
            <div className="space-y-2">
              <SessionGroupsPager initial={8} step={12}>
                {groups.map((group, idx) => (
                <details
                  key={group.id}
                  className="rounded-lg border border-border bg-muted/50 overflow-hidden group/details"
                  open={expandLatest && idx === 0}
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
                            <th className="w-6 px-1 py-2" aria-label="Drag to reorder" />
                            <th className="px-4 py-2">Date</th>
                            <th className="px-4 py-2">Car</th>
                            <th className="px-4 py-2">Track</th>
                            <th className="px-4 py-2">Tires</th>
                            <th className="px-4 py-2">Best</th>
                            <th className="px-4 py-2">Avg top 5</th>
                            <th className="px-4 py-2">Session</th>
                            <th className="px-2 py-2 w-[6rem]">Setup</th>
                            <th className="px-2 py-2 w-[7.5rem]">Pair</th>
                          </tr>
                        </thead>
                        <tbody>
                          <RunHistoryTable
                            runs={group.runs}
                            allRunsDescending={allRunsDescending.map(toCompareRunShape)}
                            userDisplayName={userDisplayName}
                            showComparePairColumn
                            enableReorder
                          />
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
                ))}
              </SessionGroupsPager>
            </div>
          </AnalysisCompareProvider>
        )}
      </section>
    </>
  );
}
