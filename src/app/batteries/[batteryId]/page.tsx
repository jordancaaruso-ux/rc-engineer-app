import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { loadUserBatteryDetail } from "@/lib/assets/loadUserAssets";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";

export default async function BatteryDetailPage(props: {
  params: Promise<{ batteryId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Battery</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view batteries.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const { batteryId } = await props.params;
  const detail = await loadUserBatteryDetail(user.id, batteryId);

  if (!detail) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Battery</h1>
            <p className="page-subtitle">Not found.</p>
          </div>
          <Link
            href="/batteries"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back
          </Link>
        </header>
      </>
    );
  }

  const { battery, displayLine, stats, recentRuns } = detail;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{displayLine}</h1>
          <p className="page-subtitle">Battery pack details and run history.</p>
        </div>
        <Link
          href="/batteries"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back
        </Link>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          <CardPanel contentClassName="space-y-3">
            <Eyebrow dot="muted">Overview</Eyebrow>
            <StatStrip className="grid-cols-2 sm:grid-cols-3">
              <StatTile label="Runs logged" value={String(stats.runCount)} className="py-2" />
              <StatTile
                label="Latest pack run"
                value={stats.latestRunNumber != null ? String(stats.latestRunNumber) : "—"}
                className="py-2"
              />
              <StatTile
                label="Total index"
                value={stats.effectiveTotal != null ? String(stats.effectiveTotal) : "—"}
                accent
                className="py-2"
              />
            </StatStrip>
            <div className="grid gap-2 text-sm">
              <div>
                <span className="ui-label-meta">Pack number</span>
                <span className="ml-2 font-mono tabular-nums">{battery.packNumber}</span>
              </div>
              <div>
                <span className="ui-label-meta">Starting run count</span>
                <span className="ml-2 font-mono tabular-nums">{battery.initialRunCount}</span>
              </div>
              <div>
                <span className="ui-label-meta">Created</span>
                <span className="ml-2">{formatRunCreatedAtDateTime(battery.createdAt)}</span>
              </div>
              {battery.notes ? (
                <div>
                  <span className="ui-label-meta">Notes</span>
                  <span className="ml-2">{battery.notes}</span>
                </div>
              ) : null}
            </div>
          </CardPanel>

          <CardPanel contentClassName="space-y-3">
            <Eyebrow dot="muted">Recent runs</Eyebrow>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runs linked yet.{" "}
                <Link href="/runs/new" prefetch className="text-primary hover:underline">
                  Log a run
                </Link>{" "}
                and select this pack.
              </p>
            ) : (
              <ul className="space-y-2">
                {recentRuns.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <Link
                      href={`/runs/history?focusRun=${encodeURIComponent(run.id)}`}
                      prefetch
                      className="tap-active font-medium hover:underline"
                    >
                      {run.car?.name ?? "Run"}
                      {run.track?.name ? ` · ${run.track.name}` : ""}
                    </Link>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      Pack run {run.batteryRunNumber} · {formatRunCreatedAtDateTime(run.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardPanel>
        </div>
      </section>
    </>
  );
}
