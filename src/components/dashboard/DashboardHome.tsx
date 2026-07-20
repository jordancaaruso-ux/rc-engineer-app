import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardDayVerdictCard } from "@/components/dashboard/DashboardDayVerdictCard";
import { DashboardNextOutingCard } from "@/components/dashboard/DashboardNextOutingCard";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { CardPanel } from "@/components/ui/CardPanel";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Adaptive dashboard — two modes, auto-switched (docs/DASHBOARD_NORTH_STAR.md;
 * v2 founder-locked 2026-07-19). The boundary rule: "now & next" — today plus
 * the next action, verdicts not evidence; depth lives in Analysis / Sessions.
 *
 *   Track day (run/draft today, or an active event):
 *     CTA → Day verdict (computed instruments; Engineer on demand in the
 *     footer) → Things to try → 30-day summary
 *   Off day:
 *     CTA → Next outing (event countdown + test plan; plan-only without an
 *     event) → Things to do → 30-day summary
 *
 * Retired in v2 (2026-07-19): the Today-so-far run strip (the run list lives in
 * Sessions — the verdict card is its door), the last-session digest card (one
 * "last visit" line in the outing card carries the story), the next-event-prep
 * card (absorbed by the outing card), and the auto Engineer read (on-demand
 * only, via the verdict-card footer).
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
    thingsToTry,
    thingsToDo,
    summary,
    records,
    newPb,
    hasRunToday,
    todayDraftRunId,
    todayDraftSavedAt,
    todayContext,
    todayVerdict,
  } = model;

  // Server-resolved mode. The client draft provider can only add a draft the
  // server already knows about on next render — good enough for mode choice.
  const isTrackDay =
    hasRunToday || Boolean(todayDraftRunId) || featuredEvent?.status === "active";

  const nextEvent = featuredEvent?.status === "next" ? featuredEvent : null;

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
            {todayVerdict ? (
              <Reveal index={1}>
                <DashboardDayVerdictCard verdict={todayVerdict} context={todayContext} />
              </Reveal>
            ) : null}

            {/* The driver's own experiment list, live during a session. */}
            <Reveal index={2}>
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
            <Reveal index={1}>
              <DashboardNextOutingCard
                event={nextEvent}
                thingsToTry={thingsToTry}
                openTodoCount={thingsToDo.length}
              />
            </Reveal>

            <Reveal index={2}>
              <CardPanel>
                <ActionItemListPanel
                  list="do"
                  title="Things to do"
                  addPlaceholder="Add a reminder…"
                  initialItems={thingsToDo}
                  embedded
                />
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
