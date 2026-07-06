import Link from "next/link";
import { Suspense } from "react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { formatLap } from "@/lib/runLaps";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardPreviousRunCard } from "@/components/dashboard/DashboardPreviousRunCard";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { IdeasSheetFab } from "@/components/dashboard/IdeasSheetFab";
import { DashboardEngineerSuggestionsSection } from "@/components/dashboard/DashboardEngineerSuggestionsSection";
import { SHOW_DASHBOARD_ENGINEER_SUGGESTIONS } from "@/lib/featureFlags";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { CardPanel } from "@/components/ui/CardPanel";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { Eyebrow, PanelSubtitle, PanelTitle, StatStrip, StatTile } from "@/components/ui/panel";

/** Time-of-day greeting + date chip in the user's zone; falls back gracefully on a bad zone. */
function headerContext(displayTimeZone: string): { daypart: string; dateChip: string } {
  const now = new Date();
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: displayTimeZone,
      }).format(now)
    );
    const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const dateChip = new Intl.DateTimeFormat("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: displayTimeZone,
    }).format(now);
    return { daypart, dateChip };
  } catch {
    return { daypart: "Welcome back", dateChip: "" };
  }
}

export function DashboardHome({
  model,
  displayTimeZone,
  greetingName,
}: {
  model: DashboardHomeModel;
  /** IANA zone from rc_tz cookie (UTC until cookie exists). */
  displayTimeZone: string;
  /** First name for the header greeting; null → daypart only. */
  greetingName?: string | null;
}) {
  const {
    featuredEvent,
    recentRun,
    thingsToTry,
    thingsToDo,
    summary,
    todayRunCount,
    todayDraftRunId,
    todayDraftSavedAt,
    engineerSuggestionsPrimaryRunId,
  } = model;
  const { daypart, dateChip } = headerContext(displayTimeZone);

  return (
    <>
      <header className="page-header page-header-dashboard">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-greeting">
            {greetingName ? `${daypart}, ${greetingName}` : daypart}
          </p>
        </div>
        {dateChip ? <span className="page-header-chip">{dateChip}</span> : null}
      </header>

      <section className="page-body max-w-3xl">
        <DashboardSummaryCard
          summary={summary}
          todayRunCount={todayRunCount}
          serverDraftRunId={todayDraftRunId}
          serverDraftSavedAt={todayDraftSavedAt}
        />

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

        {/* Desktop keeps the inline Try/Do card (there's room + no FAB); mobile
            gets the same lists via the bottom-left Ideas sheet below. */}
        <CardPanel className="hidden md:block" contentClassName="space-y-3">
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

      <IdeasSheetFab thingsToTry={thingsToTry} thingsToDo={thingsToDo} />
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
        <StatStrip
          className={isActive ? "mt-2.5" : "relative z-10 mt-2.5 pointer-events-none"}
          gridClassName="grid-cols-2 sm:grid-cols-3"
        >
          <StatTile label="Best lap" value={formatLap(featuredEvent.latest?.bestLap ?? null)} accent className="py-2" />
          <StatTile label="Avg top 5" value={formatLap(featuredEvent.latest?.avgTop5 ?? null)} className="py-2" />
          <div className="col-span-2 border-l border-t border-border px-3 py-2 sm:col-span-1">
            <div className="type-data-label">Notes</div>
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
