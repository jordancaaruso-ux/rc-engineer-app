import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Suspense } from "react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { formatAppTimestampUtc } from "@/lib/formatDate";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardPreviousRunCard } from "@/components/dashboard/DashboardPreviousRunCard";
import { DashboardEngineerSuggestionsSection } from "@/components/dashboard/DashboardEngineerSuggestionsSection";
import { SHOW_DASHBOARD_ENGINEER_SUGGESTIONS } from "@/lib/featureFlags";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

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
    todayRunCount,
    todayDraftRunId,
    todayDraftSavedAt,
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

  const heroBlurb = "meta" in primaryAction ? primaryAction.meta : primaryAction.blurb;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Last run, events, and session reminders.</p>
        </div>
      </header>

      <section className="page-body max-w-3xl">
        <SurfaceCard variant="hero">
          <Eyebrow dot="accent">
            {todayRunCount > 0
              ? `Today · ${todayRunCount} run${todayRunCount === 1 ? "" : "s"}`
              : "Today"}
          </Eyebrow>

          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              {todayDraftRunId ? <Eyebrow dot="accent">Unfinished run</Eyebrow> : null}
              <PanelTitle as="h2" className="mt-1">
                {primaryAction.label}
              </PanelTitle>
              {heroBlurb ? <PanelSubtitle className="mt-1.5">{heroBlurb}</PanelSubtitle> : null}
              {todayDraftRunId && todayDraftSavedAt ? (
                <div className="mt-1.5 font-mono text-[10px] tabular-nums text-faint">
                  Saved{" "}
                  <RelativeTime
                    iso={todayDraftSavedAt}
                    fallback={formatAppTimestampUtc(todayDraftSavedAt)}
                  />
                </div>
              ) : null}
            </div>

            <Link
              href={primaryAction.href}
              prefetch
              className={buttonLinkClassName(
                "primary",
                "primary-action-chip-prominent w-full shrink-0 sm:w-auto"
              )}
            >
              <span className="primary-action-chip-content">
                <span>{todayDraftRunId ? "Finish" : "Add"}</span>
                {todayDraftRunId ? (
                  <span aria-hidden className="primary-action-chip-icon text-[13px]">
                    →
                  </span>
                ) : (
                  <PlusCircle className="primary-action-chip-icon" strokeWidth={2} aria-hidden />
                )}
              </span>
            </Link>
          </div>
        </SurfaceCard>

        {SHOW_DASHBOARD_ENGINEER_SUGGESTIONS ? (
          <Suspense
            fallback={
              <HeroPanel>
                <Eyebrow dot="muted">Engineer suggestions</Eyebrow>
                <p className="ui-caption mt-1.5">Loading…</p>
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

        <DashboardPreviousRunCard recentRun={recentRun} displayTimeZone={displayTimeZone} />

        {featuredEvent ? (
          <FeaturedMeetingCard featuredEvent={featuredEvent} />
        ) : null}

        <CardPanel contentClassName="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ActionItemListPanel
              list="try"
              title="Things to try"
              addPlaceholder="Add an idea…"
              initialItems={thingsToTry}
              embedded
            />
            <ActionItemListPanel
              list="do"
              title="Things to do"
              addPlaceholder="Add a reminder…"
              initialItems={thingsToDo}
              embedded
            />
          </div>
        </CardPanel>
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
  const viewEventHref = `/events/${encodeURIComponent(featuredEvent.id)}`;

  return (
    <CardPanel className={!isActive ? "relative" : undefined}>
      <Eyebrow dot={isActive ? "gain" : "muted"}>
        {FEATURED_MEETING_LABELS[featuredEvent.status]}
      </Eyebrow>
      {!isActive ? (
        <Link
          href={viewEventHref}
          prefetch
          aria-label="View event"
          className="tap-active absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      ) : null}
      <div className={isActive ? "mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" : "relative z-10 mt-1.5 pointer-events-none"}>
        <div className="min-w-0">
          <PanelTitle>{featuredEvent.name}</PanelTitle>
          <PanelSubtitle className="mt-1">{featuredEvent.dateLabel}</PanelSubtitle>
          <PanelSubtitle className="mt-0.5">
            {featuredEvent.trackLabel ?? "Track not set — link one on the event"}
          </PanelSubtitle>
        </div>
        {isActive ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {featuredEvent.runCount > 0 ? (
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
            )}
          </div>
        ) : null}
      </div>

      {featuredEvent.runCount > 0 ? (
        <StatStrip className={isActive ? "mt-2.5 grid-cols-2 sm:grid-cols-3" : "relative z-10 mt-2.5 grid-cols-2 sm:grid-cols-3 pointer-events-none"}>
          <StatTile label="Best lap" value={formatLap(featuredEvent.latest?.bestLap ?? null)} accent className="py-2" />
          <StatTile label="Avg top 5" value={formatLap(featuredEvent.latest?.avgTop5 ?? null)} className="py-2" />
          <div className="col-span-2 bg-[#17130f]/55 px-3 py-2 sm:col-span-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Notes</div>
            <div className="mt-1 line-clamp-2 break-words text-[13px] leading-relaxed text-muted-foreground">
              {featuredEvent.latest?.notesPreview ?? "—"}
            </div>
          </div>
        </StatStrip>
      ) : (
        <PanelSubtitle className={isActive ? "mt-2.5 border-t border-border/70 pt-2.5" : "relative z-10 mt-2.5 border-t border-border/70 pt-2.5 pointer-events-none"}>
          No runs logged for this event yet.
        </PanelSubtitle>
      )}
    </CardPanel>
  );
}
