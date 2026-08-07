import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardDayVerdictCard } from "@/components/dashboard/DashboardDayVerdictCard";
import { DashboardNextOutingCard } from "@/components/dashboard/DashboardNextOutingCard";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardAddSetupCard } from "@/components/dashboard/DashboardAddSetupCard";
import { DashboardGetSetUpCard } from "@/components/dashboard/DashboardGetSetUpCard";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { DashboardTodayRunsCard } from "@/components/dashboard/DashboardTodayRunsCard";
import { DashboardLastRunReadCard } from "@/components/dashboard/DashboardLastRunReadCard";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { PendingTeamInvitesCard } from "@/components/teams/PendingTeamInvitesCard";
import type { OnboardingView } from "@/lib/onboarding/server";
import { showGetSetUpCard } from "@/lib/onboarding/visibility";
import type { DashboardSetups } from "@/lib/setup/getDashboardSetups";
import { CardPanel } from "@/components/ui/CardPanel";
import { Reveal } from "@/components/ui/Reveal";
import { cn } from "@/lib/utils";

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
 * Retired in v2 (2026-07-19): the last-session digest card (one "last visit" line
 * in the outing card carries the story), the next-event-prep card (absorbed by the
 * outing card), and the auto Engineer read (on-demand only, via the verdict-card
 * footer). The Today-so-far run strip was retired with them and came back at xl+
 * only on 2026-08-07 — see below.
 *
 * Desktop pass 2026-08-07. The stacks above ARE the phone and are unchanged. The
 * run CTA stays a full-width child of `.page-body`; everything under it goes into
 * `.dash-cols`, which `globals.css` turns into two columns at xl+, plus two
 * `hidden xl:block` cards that only exist there:
 *
 *   .dash-main  wide, left    day verdict · today's runs        (track day)
 *                             last-run read · 30-day summary    (both modes)
 *   .dash-side  narrow, right things to try                     (track day)
 *                             next outing · things to do        (off day)
 *
 * The lists went right because they are short text rows and do not earn a 750px
 * measure; the stat tiles, bar strip and setup diffs do (founder, 2026-08-07).
 *
 * The wrappers below are in PHONE order, not visual order — the locked stack leads
 * with the verdict and ends with the 30-day card, so on a track day the left column
 * is interleaved around the right one and appears as two `.dash-main` boxes that the
 * grid reunites. Do not "tidy" them into one; that would reorder the phone.
 *
 * One DOM, never a separate desktop render: these cards are stateful clients
 * (PendingTeamInvitesCard self-fetches, ActionItemListPanel holds drag state), so a
 * `hidden xl:grid` twin would double-mount the fetch and split the lists in two.
 *
 * Mobile is untouched BY CONSTRUCTION, not by care: every wrapper is a plain flex
 * column at every width with the same 0.75rem gap as the parent, DOM order still
 * equals the phone order, empty wrappers are guarded so they cannot add a stray
 * gap, and the two new cards render nothing below xl. Prove it with
 * `npm run layout:probe --width=390`, never screenshots.
 */
export function DashboardHome({
  model,
  onboarding,
  setups,
}: {
  model: DashboardHomeModel;
  /** IANA zone from rc_tz cookie (UTC until cookie exists). */
  displayTimeZone?: string;
  /** Guided-intro view; every card in it derives and self-retires. */
  onboarding?: OnboardingView;
  /** Cars for the "add a setup" ask + whether it's already satisfied; null when they have no cars. */
  setups?: DashboardSetups | null;
}) {
  const {
    featuredEvent,
    thingsToTry,
    thingsToDo,
    summary,
    records,
    newPb,
    hasRunToday,
    todayRunCount,
    todayDraftRunId,
    todayDraftSavedAt,
    todayContext,
    todayVerdict,
    // Both built on every dashboard load and, until 2026-08-07, discarded. They
    // feed the two desktop-only cards and cost no extra query.
    todayStrip,
    recentRun,
  } = model;

  // Server-resolved mode. The client draft provider can only add a draft the
  // server already knows about on next render — good enough for mode choice.
  const isTrackDay =
    hasRunToday || Boolean(todayDraftRunId) || featuredEvent?.status === "active";

  const nextEvent = featuredEvent?.status === "next" ? featuredEvent : null;
  // A meeting already under way keeps the outing card in track-day mode — it
  // carries the Things-to-try list, so it replaces the bare panel rather than
  // stacking a second copy of the same list (2026-07-29).
  const activeEvent = featuredEvent?.status === "active" ? featuredEvent : null;

  // First-run readiness (docs/ONBOARDING_NORTH_STAR.md, reversal 2026-07-23).
  // Only a car is required; the card carries the payoff + advised timing/setup and
  // self-retires once the garage is ready, a run exists, or it's dismissed. The
  // rule itself lives in `lib/onboarding/visibility.ts` — tested there, and driven
  // across every state at /debug/onboarding-preview.
  const ob = onboarding;
  const showGetSetUp = ob ? showGetSetUpCard(ob) : false;

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
        </div>
      </header>

      <section className="page-body dash-wide max-w-3xl">
        {/* First run (docs/ONBOARDING_NORTH_STAR.md, reversal 2026-07-23): the
            welcome overlay covers a truly-empty account once, then the one
            "Get set up" card leads. Both derive from what the driver HAS. */}
        {ob?.showIntro ? <WelcomeScreen /> : null}
        {showGetSetUp && ob ? (
          <Reveal index={0}>
            <DashboardGetSetUpCard
              hasCar={ob.hasCar}
              hasTimingIdentity={ob.hasTimingIdentity}
              hasSetup={ob.hasSetup}
              setupCars={setups?.cars ?? []}
            />
          </Reveal>
        ) : null}

        {/* Above the CTA and self-hiding when empty: an unanswered invite is somebody
            waiting on this driver, and push only reaches installed apps. */}
        <PendingTeamInvitesCard />

        {/* The primary action always leads — the single unmissable run entry point.
            It sits outside the two columns, so at xl+ it runs the full width of the
            page rather than shrinking: a laptop can be at the track (founder
            2026-08-07), so desktop must not treat starting a run as a phone-only
            action. Full-bleed it is a wider target than the phone card. */}
        <Reveal index={0}>
          <DashboardStartRunCta
            serverDraftRunId={todayDraftRunId}
            serverDraftSavedAt={todayDraftSavedAt}
          />
        </Reveal>

        {/* Sits UNDER the run CTA on purpose: logging still leads. The ask only, and it
            retires for good once a setup exists — the per-car "what you're running" list
            it briefly carried was retired 2026-07-29 (the Garage leads there directly).
            Suppressed while the Get-set-up card is up, which owns the ask — one at a time. */}
        {setups && !setups.hasAnySetup && !showGetSetUp ? (
          <Reveal index={1}>
            <DashboardAddSetupCard cars={setups.cars} />
          </Reveal>
        ) : null}

        {/* Two columns at xl+, one plain stack below it (`.dash-cols` in globals.css).
            `.dash-main` is the wide left column — the evidence. `.dash-side` is the
            narrow right one — the lists, which are short text rows and do not earn a
            750px measure (founder 2026-08-07).

            The wrappers appear in PHONE order, not visual order: the locked stack puts
            the verdict first and the 30-day card last, so on a track day the left
            column has to be interleaved around the right one. That is what the two
            separate `.dash-main` boxes below are for — the grid reunites them in
            column 1. Keeping DOM order is what keeps 390px untouched by construction. */}
        <div className={cn("dash-cols flex flex-col gap-3", isTrackDay && "dash-cols-split")}>
          {isTrackDay ? (
            <>
              {/* Left column, first row: how today is going. Guarded as a whole — an
                  empty wrapper is still a flex item on mobile and would add a stray
                  12px gap, and a phantom grid cell at xl. */}
              {todayVerdict || todayStrip.length > 0 ? (
                <div className="dash-main flex min-w-0 flex-col gap-3">
                  {todayVerdict ? (
                    <Reveal index={1}>
                      <DashboardDayVerdictCard verdict={todayVerdict} context={todayContext} />
                    </Reveal>
                  ) : null}

                  {/* Desktop only — the v2-retired run strip, back at xl+ where it
                      costs nothing (docs/DASHBOARD_NORTH_STAR.md, 2026-08-07). */}
                  <DashboardTodayRunsCard strip={todayStrip} />
                </div>
              ) : null}

              {/* Right column: the driver's own experiment list, live during a session
                  — inside the outing card when a meeting is running, on its own
                  otherwise. */}
              <div className="dash-side flex min-w-0 flex-col gap-3">
                <Reveal index={2}>
                  {activeEvent ? (
                    <DashboardNextOutingCard
                      event={activeEvent}
                      thingsToTry={thingsToTry}
                      openTodoCount={thingsToDo.length}
                      todayRunCount={todayRunCount}
                    />
                  ) : (
                    <CardPanel>
                      <ActionItemListPanel
                        list="try"
                        title="Things to try"
                        addPlaceholder="Add an idea…"
                        initialItems={thingsToTry}
                        embedded
                      />
                    </CardPanel>
                  )}
                </Reveal>
              </div>

              {/* Left column, second row — see the block below (shared by both modes). */}
              <DashboardEvidenceColumn
                recentRun={recentRun}
                showSetupChanges={todayStrip[0]?.runId !== recentRun?.id}
                summary={summary}
                records={records}
                newPb={newPb}
              />
            </>
          ) : (
            <>
              {/* Right column: the lists. */}
              <div className="dash-side flex min-w-0 flex-col gap-3">
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
              </div>

              {/* Left column: the evidence. */}
              <DashboardEvidenceColumn
                recentRun={recentRun}
                showSetupChanges
                summary={summary}
                records={records}
                newPb={newPb}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * The tail of the wide left column, identical in both modes: the read on the last
 * run, then ambient momentum. Ambient momentum was already "always last"
 * (2026-07-16) and still is — in the phone stack it is the final card, and at xl+
 * it is the foot of the evidence column.
 *
 * Extracted only because the track-day branch needs it AFTER the list wrapper in
 * the DOM (the phone stack puts the 30-day card last) while the off-day branch
 * needs it in the same place — one component, two call sites, no copy.
 */
function DashboardEvidenceColumn({
  recentRun,
  showSetupChanges,
  summary,
  records,
  newPb,
}: {
  recentRun: DashboardHomeModel["recentRun"];
  showSetupChanges: boolean;
  summary: DashboardHomeModel["summary"];
  records: DashboardHomeModel["records"];
  newPb: DashboardHomeModel["newPb"];
}) {
  return (
    <div className="dash-main flex min-w-0 flex-col gap-3">
      {/* Desktop only — recorded fact about the last run, no inference. On a track
          day the newest run is usually this same run, and its setup diff is already
          on the verdict card AND the run strip; suppress the third copy rather than
          print the same change three times on one screen. */}
      <DashboardLastRunReadCard run={recentRun} showSetupChanges={showSetupChanges} />

      <Reveal index={3}>
        <DashboardSummaryCard summary={summary} records={records} newPb={newPb} />
      </Reveal>
    </div>
  );
}
