import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardDayVerdictCard } from "@/components/dashboard/DashboardDayVerdictCard";
import { DashboardNextOutingCard } from "@/components/dashboard/DashboardNextOutingCard";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardAddSetupCard } from "@/components/dashboard/DashboardAddSetupCard";
import { DashboardGetSetUpCard } from "@/components/dashboard/DashboardGetSetUpCard";
import { DashboardSummaryCard } from "@/components/dashboard/DashboardSummaryCard";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { PendingTeamInvitesCard } from "@/components/teams/PendingTeamInvitesCard";
import type { OnboardingView } from "@/lib/onboarding/server";
import { showGetSetUpCard } from "@/lib/onboarding/visibility";
import type { DashboardSetups } from "@/lib/setup/getDashboardSetups";
import { CardPanel } from "@/components/ui/CardPanel";
import { Reveal } from "@/components/ui/Reveal";
import { DashboardDesktop } from "@/components/dashboard/desktop/DashboardDesktop";

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
 * Sessions), the last-session digest card, the next-event-prep card, and the auto
 * Engineer read (on-demand only, via the verdict-card footer).
 *
 * ── Desktop, 2026-08-08 ──────────────────────────────────────────────────────
 * The stacks above ARE the phone and are unchanged. At xl+ they are replaced
 * wholesale by `DashboardDesktop` — the "timing tower" design handoff: a hero
 * carrying the big lap numeral, two RatingDials and a pace chart, a ledger of the
 * last run's changes, and a 420px column with the CTA and the two lists.
 *
 * A twin render, NOT a re-flow, and that is a reversal of the 2026-08-07 pass which
 * kept one DOM. The two layouts are no longer the same cards in different places:
 * the hero has no phone equivalent and the phone's verdict / next-outing cards have
 * no desktop slot, so a single DOM would render both compositions anyway. Same call
 * as SessionsWorkbench.
 *
 * The price of a twin render is double-mounted client state, so:
 *   · `PendingTeamInvitesCard` is hoisted OUT of both trees and rendered once here —
 *     a copy in each would fetch /api/teams/invites twice per desktop load.
 *   · The two `ActionItemListPanel`s do mount twice. Only one is ever visible, both
 *     seed from the same server rows, and they can diverge only if the window is
 *     resized across 1280px mid-edit. Accepted.
 *
 * Mobile is the locked reference: everything below the desktop tree is `xl:hidden`
 * and byte-identical to before. Prove it with `npm run layout:probe --width=390`,
 * never screenshots.
 */
export function DashboardHome({
  model,
  displayTimeZone,
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

  // "FRI 07 AUG" on the desktop hero card's header row. Rendered from the rc_tz zone
  // so it agrees with the day the model bucketed today's runs into.
  //
  // It sat beside the page title until 2026-08-13, when the title went
  // screen-reader-only on desktop (globals.css, `is-echo`) because the top rail
  // already says "Dashboard". The stamp is real information the rail does NOT
  // carry, so it moved down onto the first card rather than going with the title.
  // The venue went the other way: the hero's own meta line already names the
  // track on a track day, and printing it twice on one card is worse than once.
  const todayStamp = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: displayTimeZone || "UTC",
  })
    .format(new Date())
    .replace(/,/g, "")
    .toUpperCase();
  const dayStamp = isTrackDay ? todayStamp : `${todayStamp} · Off day`;

  return (
    <>
      {/*
        Title-only header: `is-echo` hides it from md up and collapses its padding,
        so on desktop the first card starts straight under the rail. The `<h1>`
        stays in the DOM for assistive tech and for `MobileTitleCondenser`, which
        reads its text to draw the phone's compact title.
      */}
      <header className="page-header dash-header is-echo">
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
            waiting on this driver, and push only reaches installed apps.
            Hoisted OUT of both trees deliberately: it fetches its own data, and a copy
            in each would hit /api/teams/invites twice on every desktop load. */}
        <PendingTeamInvitesCard />

        {/* ── Desktop (xl+) ─────────────────────────────────────────────────────
            The 2026-08-08 handoff layout. A twin render rather than a re-flow: the
            hero's numeral, dials and chart have no phone equivalent, and the phone's
            verdict / next-outing cards have no desktop slot. Same call as
            SessionsWorkbench. Everything below is `xl:hidden` and untouched. */}
        <DashboardDesktop model={model} isTrackDay={isTrackDay} dayStamp={dayStamp} />

        {/* The primary action always leads — the single unmissable run entry point. */}
        <Reveal index={0} className="xl:hidden">
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

        {/* ── Phone (below xl) ──────────────────────────────────────────────────
            The locked stack, exactly as it was before the desktop passes: verdict or
            next-outing, the driver's list, then ambient momentum last. Nothing here
            may move — `npm run layout:probe --width=390` is the gate. */}
        <div className="flex flex-col gap-3 xl:hidden">
          {isTrackDay ? (
            <>
              {todayVerdict ? (
                <Reveal index={1}>
                  <DashboardDayVerdictCard verdict={todayVerdict} context={todayContext} />
                </Reveal>
              ) : null}

              {/* The driver's own experiment list, live during a session — inside the
                  outing card when a meeting is running, on its own otherwise. */}
              <Reveal index={2}>
                {activeEvent ? (
                  <DashboardNextOutingCard
                    event={activeEvent}
                    thingsToTry={thingsToTry}
                    openTodoCount={thingsToDo.length}
                    todayRunCount={todayRunCount}
                  />
                ) : (
                  <CardPanel dataTour="things-to-try">
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

          {/* Demoted 2026-07-16: ambient momentum rides last, never the lead. */}
          <Reveal index={3}>
            <DashboardSummaryCard summary={summary} records={records} newPb={newPb} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
