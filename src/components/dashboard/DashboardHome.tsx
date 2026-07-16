import Link from "next/link";
import { Suspense } from "react";
import { CalendarPlus } from "lucide-react";
import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardLastSessionDigestCard } from "@/components/dashboard/DashboardLastSessionDigestCard";
import { DashboardNextEventPrepCard } from "@/components/dashboard/DashboardNextEventPrepCard";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { DashboardTodaySoFarCard } from "@/components/dashboard/DashboardTodaySoFarCard";
import { DashboardEngineerSuggestionsSection } from "@/components/dashboard/DashboardEngineerSuggestionsSection";
import { SHOW_DASHBOARD_ENGINEER_SUGGESTIONS } from "@/lib/featureFlags";
import { CardPanel } from "@/components/ui/CardPanel";
import { HeroPanel } from "@/components/ui/HeroPanel";
import { Reveal } from "@/components/ui/Reveal";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Adaptive dashboard — two modes, auto-switched (docs/DASHBOARD_NORTH_STAR.md,
 * founder-locked 2026-07-16). The boundary rule: "now & next" — today plus the
 * next action, verdicts not evidence; depth lives in Analysis / Sessions.
 *
 *   Track day (run/draft today, or an active event):
 *     CTA → Today so far → Engineer's read → Things to try → 30-day summary
 *   Off day:
 *     CTA → Next event prep → Last-session digest → Try/Do lists → 30-day summary
 *
 * Retired here (2026-07-16): the launchpad doors, the previous-run card, and the
 * race-meeting card — absorbed by the mode cards above.
 */
export function DashboardHome({
  model,
}: {
  model: DashboardHomeModel;
  /** IANA zone from rc_tz cookie (UTC until cookie exists). */
  displayTimeZone?: string;
}) {
  const {
    featuredEvent,
    recentRun,
    thingsToTry,
    thingsToDo,
    summary,
    records,
    newPb,
    hasRunToday,
    todayDraftRunId,
    todayDraftSavedAt,
    todayStrip,
    todayContext,
    lastSessionDigest,
    engineerSuggestionsPrimaryRunId,
  } = model;

  // Server-resolved mode. The client draft provider can only add a draft the
  // server already knows about on next render — good enough for mode choice.
  const isTrackDay =
    hasRunToday || Boolean(todayDraftRunId) || featuredEvent?.status === "active";

  const nextEvent = featuredEvent?.status === "next" ? featuredEvent : null;

  const engineerRead =
    SHOW_DASHBOARD_ENGINEER_SUGGESTIONS && isTrackDay ? (
      <Suspense
        fallback={
          <HeroPanel>
            <Eyebrow dot="muted">Engineer&apos;s read</Eyebrow>
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
    ) : null;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
        </div>
      </header>

      <section className="page-body max-w-3xl">
        {/* The primary action always leads — the single unmissable run entry point. */}
        <Reveal index={0}>
          <DashboardStartRunCta
            serverDraftRunId={todayDraftRunId}
            serverDraftSavedAt={todayDraftSavedAt}
          />
        </Reveal>

        {isTrackDay ? (
          <>
            <Reveal index={1}>
              <DashboardTodaySoFarCard strip={todayStrip} context={todayContext} />
            </Reveal>

            {engineerRead ? <Reveal index={2}>{engineerRead}</Reveal> : null}

            {/* The driver's own experiment list, live during a session. */}
            <Reveal index={3}>
              <CardPanel>
                <ActionItemListPanel
                  list="try"
                  title="Things to try"
                  addPlaceholder="Add an idea…"
                  initialItems={thingsToTry}
                  embedded
                />
              </CardPanel>
            </Reveal>
          </>
        ) : (
          <>
            {nextEvent ? (
              <Reveal index={1}>
                <DashboardNextEventPrepCard event={nextEvent} />
              </Reveal>
            ) : null}

            {lastSessionDigest ? (
              <Reveal index={2}>
                <DashboardLastSessionDigestCard
                  digest={lastSessionDigest}
                  recentRun={recentRun}
                />
              </Reveal>
            ) : null}

            {/* No event on the calendar: keep the prep habit visible, quietly. */}
            {!nextEvent ? (
              <Reveal index={3}>
                <Link
                  href="/events"
                  prefetch
                  className="tap-active flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-4 py-3 text-[13px] font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                >
                  <CalendarPlus aria-hidden className="size-[15px]" strokeWidth={2.2} />
                  Add your next event
                </Link>
              </Reveal>
            ) : null}

            <Reveal index={4}>
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
            </Reveal>
          </>
        )}

        {/* Demoted 2026-07-16: ambient momentum rides last in both modes, never the lead. */}
        <Reveal index={5}>
          <DashboardSummaryCard summary={summary} records={records} newPb={newPb} />
        </Reveal>
      </section>
    </>
  );
}
