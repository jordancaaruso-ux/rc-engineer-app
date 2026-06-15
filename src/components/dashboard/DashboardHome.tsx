import Link from "next/link";
import { Suspense } from "react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardPreviousRunCard } from "@/components/dashboard/DashboardPreviousRunCard";
import { TodaySummaryCard } from "@/components/dashboard/TodaySummaryCard";
import { DashboardEngineerSuggestionsSection } from "@/components/dashboard/DashboardEngineerSuggestionsSection";
import { SHOW_DASHBOARD_ENGINEER_SUGGESTIONS } from "@/lib/featureFlags";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { SectionMeta, SectionTitle } from "@/components/ui/SectionTitle";

export function DashboardHome({
  model,
  displayTimeZone,
}: {
  model: DashboardHomeModel;
  /** IANA zone from rc_tz cookie (UTC until cookie exists). */
  displayTimeZone: string;
}) {
  const {
    featuredEvent,
    recentRun,
    thingsToTry,
    thingsToDo,
    todayBestLap,
    todayBestAvgTop5,
    todayBestRunId,
    todayBestRunLabel,
    todayRunCount,
    todayDraftRunId,
    todayDraftSavedAt,
    todaysChanges,
    engineerSuggestionsPrimaryRunId,
  } = model;

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
        label: "New run",
        meta: "Log a session on your car and track.",
      };

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title text-base">Dashboard</h1>
        </div>
      </header>

      <section className="page-body flex max-w-3xl flex-col gap-4">
        <HeroPanel variant="muted" className="bg-card/80">
          <Link
            href={primaryAction.href}
            className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left outline-offset-2 transition hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/40"
          >
            <div className="min-w-0 flex-1 space-y-1">
              {todayDraftRunId ? (
                <div className="text-[11px] ui-title text-accent">
                  Unfinished run
                </div>
              ) : null}
              <SectionTitle as="div" className="leading-tight">
                {primaryAction.label}
              </SectionTitle>
              {"meta" in primaryAction && primaryAction.meta ? (
                <SectionMeta as="div" className="mt-0">
                  {primaryAction.meta}
                </SectionMeta>
              ) : null}
              {"blurb" in primaryAction && primaryAction.blurb ? (
                <SectionMeta as="div" className="mt-0">
                  {primaryAction.blurb}
                </SectionMeta>
              ) : null}
              {todayDraftRunId && todayDraftSavedAt ? (
                <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
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
              className="shrink-0 rounded-md border border-primary/40 bg-background/60 px-2 py-1 text-[11px] font-medium text-primary transition group-hover:border-primary/55"
            >
              {todayDraftRunId ? "Finish →" : "Start →"}
            </span>
          </Link>
        </HeroPanel>

        {SHOW_DASHBOARD_ENGINEER_SUGGESTIONS ? (
          <Suspense
            fallback={
              <HeroPanel>
                <SectionTitle as="div" className="text-sm">
                  Engineer suggestions
                </SectionTitle>
                <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
              </HeroPanel>
            }
          >
            <DashboardEngineerSuggestionsSection
              primaryRunId={engineerSuggestionsPrimaryRunId}
              carName={recentRun?.carName ?? "Car"}
              trackName={recentRun?.trackName ?? null}
              eventName={recentRun?.eventName ?? null}
            />
          </Suspense>
        ) : null}

        {featuredEvent ? (
          <FeaturedMeetingCard featuredEvent={featuredEvent} />
        ) : null}

        <DashboardPreviousRunCard recentRun={recentRun} displayTimeZone={displayTimeZone} />

        <div className="flex flex-wrap gap-1.5">
          <Link
            href="/engineer"
            className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
          >
            Chat with engineer
          </Link>
          <Link
            href="/setup"
            className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
          >
            Analyze recent setups
          </Link>
          <Link
            href="/runs/history"
            className={buttonLinkClassName("outline", "text-muted-foreground hover:text-foreground")}
          >
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
          hasActiveEvent={featuredEvent?.status === "active"}
        />

        <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <ActionItemListPanel
              list="try"
              title="Try"
              addPlaceholder="Add an idea…"
              initialItems={thingsToTry}
              embedded
            />
            <ActionItemListPanel
              list="do"
              title="Do"
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

const FEATURED_MEETING_LABELS = {
  active: "Active race meeting",
  next: "Next race meeting",
  last: "Last race meeting",
} as const;

function FeaturedMeetingCard({
  featuredEvent,
}: {
  featuredEvent: NonNullable<DashboardHomeModel["featuredEvent"]>;
}) {
  const isActive = featuredEvent.status === "active";

  return (
    <CardPanel className="p-4">
      <div className="text-xs font-medium text-muted-foreground">
        {FEATURED_MEETING_LABELS[featuredEvent.status]}
      </div>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium leading-tight text-foreground">{featuredEvent.name}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{featuredEvent.dateLabel}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {featuredEvent.trackLabel ?? "Track not set — link one on the event"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {isActive ? (
            featuredEvent.runCount > 0 ? (
              <Link
                href={`/runs/new?fromDashboard=continue&eventId=${encodeURIComponent(featuredEvent.id)}`}
                className={buttonLinkClassName("primary")}
              >
                Log next run
              </Link>
            ) : (
              <Link
                href={`/runs/new?fromDashboard=first&eventId=${encodeURIComponent(featuredEvent.id)}`}
                className={buttonLinkClassName("primary")}
              >
                Log first run today
              </Link>
            )
          ) : (
            <Link
              href={`/events/${encodeURIComponent(featuredEvent.id)}`}
              className={buttonLinkClassName("outline")}
            >
              View event →
            </Link>
          )}
        </div>
      </div>

      {featuredEvent.runCount > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-2.5 text-[11px]">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] ui-title text-muted-foreground">Best</span>
            <span className="font-mono tabular-nums text-foreground">
              {formatLap(featuredEvent.latest?.bestLap ?? null)}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] ui-title text-muted-foreground">Avg 5</span>
            <span className="font-mono tabular-nums text-foreground">
              {formatLap(featuredEvent.latest?.avgTop5 ?? null)}
            </span>
          </div>
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <div className="text-[10px] ui-title text-muted-foreground">Notes</div>
            <div className="mt-0.5 line-clamp-2 break-words text-muted-foreground">
              {featuredEvent.latest?.notesPreview ?? "—"}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          No runs logged for this event yet.
        </p>
      )}
    </CardPanel>
  );
}

