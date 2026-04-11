import Link from "next/link";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { DashboardWorkflowContext } from "@/components/dashboard/DashboardWorkflowContext";
import { DetectedRunPromptsBanner } from "@/components/dashboard/DetectedRunPromptsBanner";
import { IncompleteLoggingRunsBanner } from "@/components/dashboard/IncompleteLoggingRunsBanner";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted/60 hover:text-foreground ${className}`;
}

export function DashboardHome({ model }: { model: DashboardHomeModel }) {
  const {
    activeEvent,
    hasRunToday,
    perfBestLap,
    perfAvgTop5,
    recentRun,
    thingsToTry,
    detectedRunPrompts,
    incompleteRuns,
  } = model;

  const standaloneHref = "/runs/new";
  const standaloneLabel = hasRunToday ? "Log another run today" : "Log today's run";

  return (
    <>
      <header className="page-header">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="page-title text-base">Dashboard</h1>
            <p className="page-subtitle mt-0.5 max-w-xl text-[11px] leading-snug">
              Track-ready overview: current event, quick actions, and last session numbers.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Link href="/runs/new" className={btnPrimary()}>
              Log new run
            </Link>
            <Link href="/runs/history" className={btnGhost()}>
              Open analysis
            </Link>
          </div>
        </div>
      </header>

      <section className="page-body flex max-w-3xl flex-col gap-3">
        <DetectedRunPromptsBanner prompts={detectedRunPrompts} />
        <IncompleteLoggingRunsBanner rows={incompleteRuns} />

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/30">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current context</div>

          {activeEvent ? (
            <>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium leading-tight text-foreground">{activeEvent.name}</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {activeEvent.trackLabel ?? "Track not set — link one on the event"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
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
              </div>

              {activeEvent.runCount > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-2.5 text-[11px]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Best</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatLap(activeEvent.latest?.bestLap ?? null)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Avg 5</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatLap(activeEvent.latest?.avgTop5 ?? null)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Notes</div>
                    <div className="mt-0.5 line-clamp-2 break-words text-muted-foreground">
                      {activeEvent.latest?.notesPreview ?? "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  No runs logged for this event yet.
                </p>
              )}
            </>
          ) : (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] leading-snug text-muted-foreground">
                No active event for today. Create one on{" "}
                <Link href="/events" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-accent">
                  Events
                </Link>{" "}
                when you are at the track.
              </p>
              <Link href={standaloneHref} className={`${btnPrimary()} shrink-0 self-start sm:self-auto`}>
                {standaloneLabel}
              </Link>
            </div>
          )}
        </div>

        <DashboardWorkflowContext recentRun={recentRun} thingsToTry={thingsToTry} />

        <div className="flex flex-wrap gap-1.5">
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

        <div className="overflow-hidden rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/25">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Session PB (logged laps)
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <div>
              <div className="text-[10px] font-medium text-muted-foreground">Best lap</div>
              <div className="font-mono text-sm tabular-nums text-foreground">{formatLap(perfBestLap)}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-muted-foreground">Avg top 5</div>
              <div className="font-mono text-sm tabular-nums text-foreground">{formatLap(perfAvgTop5)}</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
