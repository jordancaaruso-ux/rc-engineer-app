import Link from "next/link";
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
          <h1 className="page-title text-base">Dashboard</h1>
        </div>
      </header>

      <section className="page-body flex max-w-3xl flex-col gap-3">
        <SurfaceCard variant="hero">
          <Eyebrow dot="accent">
            {todayRunCount > 0
              ? `Today · ${todayRunCount} run${todayRunCount === 1 ? "" : "s"}`
              : "Today"}
          </Eyebrow>

          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              {todayDraftRunId ? <Eyebrow dot="accent">Unfinished run</Eyebrow> : null}
              <h1 className="mt-1 text-[22px] font-extrabold leading-none tracking-tight text-foreground sm:text-[24px]">
                {primaryAction.label}
              </h1>
              {heroBlurb ? (
                <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                  {heroBlurb}
                </p>
              ) : null}
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
              className="tap-active group inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.12em] text-primary-foreground shadow-glow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
            >
              {todayDraftRunId ? "Finish" : "Add"}
              <span
                aria-hidden
                className="inline-flex shrink-0 items-center justify-center text-[13px] font-bold leading-none"
              >
                {todayDraftRunId ? "→" : "+"}
              </span>
            </Link>
          </div>
        </SurfaceCard>

        {SHOW_DASHBOARD_ENGINEER_SUGGESTIONS ? (
          <Suspense
            fallback={
              <HeroPanel>
                <Eyebrow dot="muted">Engineer suggestions</Eyebrow>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Loading…</p>
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

        <CardPanel contentClassName="space-y-2">
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

  return (
    <CardPanel>
      <Eyebrow dot={isActive ? "gain" : "muted"}>
        {FEATURED_MEETING_LABELS[featuredEvent.status]}
      </Eyebrow>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <PanelTitle>{featuredEvent.name}</PanelTitle>
          <PanelSubtitle className="mt-1">{featuredEvent.dateLabel}</PanelSubtitle>
          <PanelSubtitle className="mt-0.5">
            {featuredEvent.trackLabel ?? "Track not set — link one on the event"}
          </PanelSubtitle>
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
        <StatStrip className="mt-2.5 grid-cols-2 sm:grid-cols-3">
          <StatTile label="Best lap" value={formatLap(featuredEvent.latest?.bestLap ?? null)} accent className="py-2" />
          <StatTile label="Avg top 5" value={formatLap(featuredEvent.latest?.avgTop5 ?? null)} className="py-2" />
          <div className="col-span-2 bg-[#17130f]/55 px-3 py-2 sm:col-span-1">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Notes</div>
            <div className="mt-1 line-clamp-2 break-words text-[13px] leading-relaxed text-muted-foreground">
              {featuredEvent.latest?.notesPreview ?? "—"}
            </div>
          </div>
        </StatStrip>
      ) : (
        <PanelSubtitle className="mt-2.5 border-t border-border/70 pt-2.5">
          No runs logged for this event yet.
        </PanelSubtitle>
      )}
    </CardPanel>
  );
}
