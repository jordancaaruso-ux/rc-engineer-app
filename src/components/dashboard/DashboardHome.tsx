import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatRunCreatedAtDateTime, formatAppTimestampUtc } from "@/lib/formatDate";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { IncompleteLoggingRunsBanner } from "@/components/dashboard/IncompleteLoggingRunsBanner";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { TodaySummaryCard } from "@/components/dashboard/TodaySummaryCard";
import { RelativeTime } from "@/components/ui/RelativeTime";

function btnPrimary(className = "") {
  return `inline-flex items-center justify-center rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105 ${className}`;
}

function btnGhost(className = "") {
  return `inline-flex items-center justify-center rounded-lg border border-border bg-card/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-muted/60 hover:text-foreground ${className}`;
}

export function DashboardHome({
  model,
  displayTimeZone,
}: {
  model: DashboardHomeModel;
  /** IANA zone from rc_tz cookie (UTC until cookie exists). */
  displayTimeZone: string;
}) {
  const {
    activeEvent,
    recentRun,
    thingsToTry,
    thingsToDo,
    incompleteRuns,
    todayBestLap,
    todayBestAvgTop5,
    todayBestRunId,
    todayBestRunLabel,
    todayRunCount,
    todayDraftRunId,
    todayDraftSavedAt,
    todaysChanges,
  } = model;

  // The green "Unfinished run" card owns the representation of today's draft,
  // so strip it from the amber catch-all banner. Otherwise the same run shows
  // up twice: once as the green contextual CTA, once as an amber reminder.
  const incompleteRunsFiltered = todayDraftRunId
    ? incompleteRuns.filter((r) => r.id !== todayDraftRunId)
    : incompleteRuns;

  // One prominent "what do I do next" entry point. Resolves to the
  // in-flight draft if there is one, otherwise the new-run form. Sits at
  // the top of the body so the driver never has to hunt for the Log Your
  // Run nav item between runs.
  const primaryAction = todayDraftRunId
    ? {
        href: `/runs/${encodeURIComponent(todayDraftRunId)}/edit`,
        label: "Complete logged run",
        blurb: "Finish the run you saved as a draft earlier.",
      }
    : {
        href: "/runs/new",
        label: "Log new run",
        blurb: "Start a fresh run log for your next session.",
      };

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title text-base">Dashboard</h1>
          <p className="page-subtitle mt-0.5 max-w-xl text-[11px] leading-snug">
            Previous run, today&apos;s numbers, and your active race meeting when there is one.
          </p>
        </div>
      </header>

      <section className="page-body flex max-w-3xl flex-col gap-3">
        <IncompleteLoggingRunsBanner rows={incompleteRunsFiltered} displayTimeZone={displayTimeZone} />

        <Link
          href={primaryAction.href}
          className={cn(
            "group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 shadow-sm shadow-black/20 transition",
            todayDraftRunId
              ? "border-emerald-500/40 bg-emerald-500/10 hover:border-emerald-500/60 hover:bg-emerald-500/15"
              : "border-border bg-card/70 hover:border-accent/50 hover:bg-card"
          )}
        >
          <div className="min-w-0">
            <div
              className={cn(
                "text-[11px] font-medium uppercase tracking-wide",
                todayDraftRunId
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-muted-foreground"
              )}
            >
              {todayDraftRunId ? "Unfinished run" : "Next"}
            </div>
            <div className="mt-0.5 text-sm font-medium leading-tight text-foreground">
              {primaryAction.label}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {primaryAction.blurb}
            </div>
            {todayDraftRunId && todayDraftSavedAt ? (
              <div className="mt-0.5 text-[10px] font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                Saved{" "}
                <RelativeTime
                  iso={todayDraftSavedAt}
                  fallback={formatAppTimestampUtc(todayDraftSavedAt)}
                />
              </div>
            ) : null}
          </div>
          <span
            aria-hidden
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition",
              todayDraftRunId
                ? "border-emerald-500/40 bg-background/60 text-emerald-700 group-hover:border-emerald-500/60 dark:text-emerald-300"
                : "border-border bg-background/60 text-muted-foreground group-hover:border-accent/50 group-hover:text-foreground"
            )}
          >
            {todayDraftRunId ? "Finish →" : "Start →"}
          </span>
        </Link>

        {activeEvent ? (
          <EventContextCard activeEvent={activeEvent} />
        ) : null}

        <PreviousRunCard recentRun={recentRun} displayTimeZone={displayTimeZone} />

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

        <TodaySummaryCard
          todayBestLap={todayBestLap}
          todayBestAvgTop5={todayBestAvgTop5}
          todayBestRunId={todayBestRunId}
          todayBestRunLabel={todayBestRunLabel}
          todayRunCount={todayRunCount}
          todaysChanges={todaysChanges}
          displayTimeZone={displayTimeZone}
        />

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/30">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Lists
          </div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <ActionItemListPanel
              list="try"
              title="Things to try"
              hint="From logged runs and manual adds. Remove archives the item."
              addPlaceholder="Add an idea…"
              initialItems={thingsToTry}
              embedded
            />
            <ActionItemListPanel
              list="do"
              title="Things to do"
              hint="Pre–next-run checks (e.g. verify a bolt). Same list as in Log your run. Remove archives the item."
              addPlaceholder="Add a reminder…"
              initialItems={thingsToDo}
              embedded
            />
          </div>
        </div>
      </section>
    </>
  );
}

function EventContextCard({
  activeEvent,
}: {
  activeEvent: NonNullable<DashboardHomeModel["activeEvent"]>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/30">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Active race meeting
      </div>
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
    </div>
  );
}

function PreviousRunCard({
  recentRun,
  displayTimeZone,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  displayTimeZone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/30">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Previous run
        </div>
      </div>
      {recentRun ? (
        <div className="mt-2 space-y-2 text-[11px]">
          <div className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 sm:grid-cols-[4.5rem_1fr]">
            <span className="text-muted-foreground">When</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {formatRunCreatedAtDateTime(
                resolveRunDisplayInstant({
                  createdAt: recentRun.createdAt,
                  sessionCompletedAt: recentRun.sessionCompletedAt,
                  loggingCompletedAt: recentRun.loggingCompletedAt,
                }),
                displayTimeZone
              )}
            </span>
            <span className="text-muted-foreground">Car</span>
            <span className="min-w-0 font-medium text-foreground">{recentRun.carName}</span>
            <span className="text-muted-foreground">Track</span>
            <span className="min-w-0 text-muted-foreground">{recentRun.trackName ?? "—"}</span>
            {recentRun.eventName ? (
              <>
                <span className="text-muted-foreground">Event</span>
                <span className="min-w-0 text-muted-foreground">{recentRun.eventName}</span>
              </>
            ) : null}
            <span className="text-muted-foreground">Session</span>
            <span className="min-w-0 text-muted-foreground">{recentRun.sessionLabel}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2">
            <span className="tabular-nums">
              <span className="mr-1.5 text-[10px] font-medium text-muted-foreground">Best</span>
              <span className="font-mono">{formatLap(recentRun.bestLap)}</span>
            </span>
            <span className="tabular-nums">
              <span className="mr-1.5 text-[10px] font-medium text-muted-foreground">Avg 5</span>
              <span className="font-mono">{formatLap(recentRun.avgTop5)}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link
              href={`/runs/history?focusRun=${encodeURIComponent(recentRun.id)}`}
              className={btnGhost()}
            >
              Open run
            </Link>
            <Link
              href={`/runs/history?focusRun=${encodeURIComponent(recentRun.id)}`}
              className={btnGhost()}
            >
              Open analysis
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(recentRun.id)}/edit`}
              className={btnGhost()}
            >
              Edit log
            </Link>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">No runs yet — log one to populate this.</p>
      )}
    </div>
  );
}
