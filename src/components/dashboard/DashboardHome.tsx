import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:brightness-110 transition ${className}`;
}

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-medium hover:bg-secondary/60 transition ${className}`;
}

export function DashboardHome({ model }: { model: DashboardHomeModel }) {
  const { activeEvent, hasRunToday, perfBestLap, perfAvgTop5, recentRun } = model;

  const standaloneHref = "/runs/new";
  const standaloneLabel = hasRunToday ? "Log another run today" : "Log today's run";

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Track-ready overview: current event, quick actions, and last session numbers.
          </p>
        </div>
      </header>

      <section className="page-body flex flex-col gap-4 max-w-3xl">
        <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
            Current context
          </div>

          {activeEvent ? (
            <>
              <div>
                <h2 className="text-base font-semibold text-foreground leading-tight">
                  {activeEvent.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {activeEvent.trackLabel ?? "Track not set — link one on the event"}
                </p>
              </div>

              {activeEvent.runCount > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs border-t border-border/60 pt-3">
                  <div>
                    <div className="font-mono text-[10px] text-muted-foreground">Best lap</div>
                    <div className="font-mono tabular-nums mt-0.5">
                      {formatLap(activeEvent.latest?.bestLap ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] text-muted-foreground">Avg top 5</div>
                    <div className="font-mono tabular-nums mt-0.5">
                      {formatLap(activeEvent.latest?.avgTop5 ?? null)}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 min-w-0">
                    <div className="font-mono text-[10px] text-muted-foreground">Notes</div>
                    <div className="mt-0.5 text-muted-foreground line-clamp-2 break-words">
                      {activeEvent.latest?.notesPreview ?? "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground border-t border-border/60 pt-3">
                  No runs logged for this event yet.
                </p>
              )}

              <div className="pt-1">
                {activeEvent.runCount > 0 ? (
                  <Link
                    href={`/runs/new?fromDashboard=continue&eventId=${encodeURIComponent(activeEvent.id)}`}
                    className={btnPrimary()}
                  >
                    Log next run
                  </Link>
                ) : (
                  <Link
                    href={`/runs/new?fromDashboard=first&eventId=${encodeURIComponent(activeEvent.id)}`}
                    className={btnPrimary()}
                  >
                    Log first run today
                  </Link>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No active event for today. Create one on{" "}
                <Link href="/events" className="text-foreground underline underline-offset-2">
                  Events
                </Link>{" "}
                when you are at the track.
              </p>
              <Link href={standaloneHref} className={btnPrimary()}>
                {standaloneLabel}
              </Link>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/engineer" className={btnGhost()}>
            Chat with engineer
          </Link>
          <Link href="/setup" className={btnGhost()}>
            Analyze recent setups
          </Link>
          <Link href="/runs/history" className={btnGhost()}>
            View runs
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary/20 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-2">
              Session PB (logged laps)
            </div>
            <div className="flex gap-6 text-xs">
              <div>
                <div className="text-muted-foreground">Best lap</div>
                <div className="font-mono tabular-nums text-sm mt-0.5">{formatLap(perfBestLap)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Avg top 5</div>
                <div className="font-mono tabular-nums text-sm mt-0.5">{formatLap(perfAvgTop5)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-3 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-2">
              Recent run
            </div>
            {recentRun ? (
              <div className="text-xs space-y-1 min-w-0">
                <div className="font-medium text-foreground truncate">{recentRun.carName}</div>
                <div className="text-muted-foreground truncate">
                  {recentRun.trackName ?? "—"} · {recentRun.sessionLabel}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {formatRunCreatedAtDateTime(recentRun.createdAt)}
                </div>
                <div className="flex gap-4 pt-1 font-mono tabular-nums">
                  <span>Best {formatLap(recentRun.bestLap)}</span>
                  <span>Avg5 {formatLap(recentRun.avgTop5)}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No runs yet.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
