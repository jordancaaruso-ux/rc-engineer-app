import type { ReactNode } from "react";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { loadUserTireSetDetail } from "@/lib/assets/loadUserAssets";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, StatStrip, StatTile } from "@/components/ui/panel";

export default async function TireSetDetailPage(props: {
  params: Promise<{ tireSetId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Tire set</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view tire sets.
          </CardPanel>
        </section>
      </>
    );
  }

  const user = await requireCurrentUser();
  const { tireSetId } = await props.params;
  const detail = await loadUserTireSetDetail(user.id, tireSetId);

  if (!detail) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Tire set</h1>
            <p className="page-subtitle">Not found.</p>
          </div>
          <Link
            href="/tire-sets"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back
          </Link>
        </header>
      </>
    );
  }

  const { tireSet, displayLine, stats, recentRuns } = detail;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{displayLine}</h1>
          <p className="page-subtitle">Tire set details and run history.</p>
        </div>
        <Link
          href="/tire-sets"
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
                label="Latest set run"
                value={stats.latestRunNumber != null ? String(stats.latestRunNumber) : "—"}
                className="py-2"
              />
              <StatTile
                label="Wear index"
                value={stats.effectiveTotal != null ? String(stats.effectiveTotal) : "—"}
                accent
                className="py-2"
              />
            </StatStrip>
            <div className="grid gap-2 text-sm">
              <div>
                <span className="ui-label-meta">Set number</span>
                <span className="ml-2 font-mono tabular-nums">{tireSet.setNumber}</span>
              </div>
              <div>
                <span className="ui-label-meta">Starting run count</span>
                <span className="ml-2 font-mono tabular-nums">{tireSet.initialRunCount}</span>
              </div>
              {tireSet.tireType ? (
                <div>
                  <span className="ui-label-meta">Tire type</span>
                  <span className="ml-2">
                    {tireSet.tireType.displayName}
                    <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                      {tireSet.tireType.modelCode}
                    </span>
                  </span>
                </div>
              ) : (
                <div>
                  <span className="ui-label-meta">Label</span>
                  <span className="ml-2">{tireSet.label}</span>
                </div>
              )}
              {tireSet.insertLabel ? (
                <div>
                  <span className="ui-label-meta">Insert</span>
                  <span className="ml-2">{tireSet.insertLabel}</span>
                </div>
              ) : null}
              {tireSet.wheelLabel ? (
                <div>
                  <span className="ui-label-meta">Wheel</span>
                  <span className="ml-2">{tireSet.wheelLabel}</span>
                </div>
              ) : null}
              {tireSet.specificModel ? (
                <div>
                  <span className="ui-label-meta">Specific model</span>
                  <span className="ml-2">{tireSet.specificModel}</span>
                </div>
              ) : null}
              <div>
                <span className="ui-label-meta">Created</span>
                <span className="ml-2">{formatRunCreatedAtDateTime(tireSet.createdAt)}</span>
              </div>
              {tireSet.notes ? (
                <div>
                  <span className="ui-label-meta">Notes</span>
                  <span className="ml-2">{tireSet.notes}</span>
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
                and select this set.
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
                      Set run {run.tireRunNumber} · {formatRunCreatedAtDateTime(run.createdAt)}
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
