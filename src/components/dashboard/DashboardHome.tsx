import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardListFold } from "@/components/dashboard/DashboardListFold";
import { DashboardAskEngineerCard } from "@/components/dashboard/DashboardAskEngineerCard";
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
import { Reveal } from "@/components/ui/Reveal";
import { DashboardDesktop } from "@/components/dashboard/desktop/DashboardDesktop";
import { selectDashboardStarterQuestions } from "@/lib/engineerStarterQuestions";

/**
 * Adaptive dashboard — two modes, auto-switched (docs/DASHBOARD_NORTH_STAR.md;
 * v2 founder-locked 2026-07-19). The boundary rule: "now & next" — today plus
 * the next action, verdicts not evidence; depth lives in Analysis / Sessions.
 *
 *   Track day (run/draft today, or an active event):
 *     CTA → Day verdict (computed instruments) → [meeting countdown] →
 *     Ask the Engineer → Ideas (open) → Things to do (folded)
 *   Off day:
 *     CTA → Next outing (event countdown; a book-a-track-day nudge when nothing
 *     is booked) → How you're going (per-track trends) → Ask the Engineer →
 *     Ideas (folded) → Things to do (folded)
 *
 * ── The 2026-08-20 pass (founder call) ───────────────────────────────────────
 * Both lists fold to a single labelled row (`DashboardListFold`) and moved to the
 * BACK of both stacks: the yellow edge tab opens the same two lists from anywhere
 * in the app, so the dashboard copy is a convenience, not the way in. Ideas still
 * opens itself on a track day, where the list is live during the session.
 *
 * That freed the middle, which now carries a read and a question. **How you're
 * going** is the old 30-day summary card promoted off the bottom, opening on a
 * session trend per track. **Ask the Engineer** is one written starter question,
 * cycling — and on a track day it takes the slot the trends have on an off day,
 * because at the track the next change is the question, not last month.
 *
 * The 30-day card does NOT appear on a track day, which means a new record breaking
 * mid-meeting has no celebration until the drive home. Known, and the founder's call.
 *
 * The outing card and the Ideas list were ONE tall card until 2026-08-18, when a
 * founder call split them. The list is now the same card on every kind of day
 * rather than moving inside the outing card whenever a meeting was running.
 *
 * Retired in v2 (2026-07-19): the Today-so-far run strip (the run list lives in
 * Sessions), the last-session digest card, the next-event-prep card, and the auto
 * Engineer read — the Engineer is still only ever asked on purpose, now from its
 * own card rather than the verdict card's footer.
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
 * Mobile is the locked reference: everything below the desktop tree is `xl:hidden`,
 * and no desktop pass may move it. It changes only on its own founder call — the
 * 2026-08-20 list fold is one. Prove a change with `npm run layout:probe --width=390`,
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
  // A meeting already under way keeps the outing card in track-day mode (2026-07-29).
  // Since the 2026-08-18 split it carries nothing but the countdown, so it sits above
  // the Ideas card rather than swallowing it.
  const activeEvent = featuredEvent?.status === "active" ? featuredEvent : null;

  // First-run readiness (docs/ONBOARDING_NORTH_STAR.md, reversal 2026-07-23,
  // amended 2026-08-18). The card walks car → timing and only then hands over the
  // run; a setup sheet rides along as advised. It retires on the first run or
  // Ignore — no longer on readiness, because readiness IS its payoff state. The
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

  // The driver's own list, in one place on every kind of day (founder call 2026-08-18).
  // It is the demo walkthrough's last stop on the phone — the desktop's `test-plan` card
  // is a different node, see `tourSteps.ts`.
  //
  // Called "Ideas" wherever it appears now. It used to answer to "Test plan" whenever an
  // event was booked and "Things to try" otherwise, so booking a race quietly renamed the
  // driver's own list.
  //
  // Folded on the phone since 2026-08-20 (`DashboardListFold`): the list opens itself on a
  // track day, where it is live during the session, and starts closed on an off day, where
  // two open lists WERE the whole page. The desktop column is untouched — it has its own
  // card and its own 6-row cap.
  const ideasCard = (
    <DashboardListFold
      label="Ideas"
      count={thingsToTry.length}
      defaultOpen={isTrackDay}
      dataTour="things-to-try"
    >
      <ActionItemListPanel
        list="try"
        title="Ideas"
        addPlaceholder="Add an idea…"
        addLabel="Add an idea"
        initialItems={thingsToTry}
        embedded
        titleHidden
      />
    </DashboardListFold>
  );

  // Reminders, folded, and now on a track day too — both lists ride at the back of every
  // stack rather than one of them existing only on an off day.
  const thingsToDoCard = (
    <DashboardListFold label="Things to do" count={thingsToDo.length}>
      <ActionItemListPanel
        list="do"
        title="Things to do"
        addPlaceholder="Add a reminder…"
        initialItems={thingsToDo}
        embedded
        titleHidden
      />
    </DashboardListFold>
  );

  /*
   * The questions the Ask-the-Engineer card offers. Server-picked so the first one is in the
   * HTML — the card cycles from there.
   *
   * `recentRun` is the "has anything been logged" test: it is the Engineer's Auto subject, so
   * when it exists the read-this-run questions have something to read. With nothing logged the
   * selector drops them and the card still has plenty to ask.
   */
  const askQuestions = selectDashboardStarterQuestions({
    hasRuns: Boolean(recentRun),
    isTrackDay,
  });


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
            Rebuilt 2026-08-20 (founder call). Today or the next outing, then how you're
            going, then one question worth asking — and the two lists LAST, folded, because
            the edge tab reaches the same two lists from anywhere in the app and is the door
            that actually gets used. `npm run layout:probe --width=390` is still the gate. */}
        <div className="flex flex-col gap-3 xl:hidden">
          {isTrackDay ? (
            <>
              {todayVerdict ? (
                <Reveal index={1}>
                  <DashboardDayVerdictCard verdict={todayVerdict} context={todayContext} />
                </Reveal>
              ) : null}

              {activeEvent ? (
                <Reveal index={2}>
                  <DashboardNextOutingCard event={activeEvent} todayRunCount={todayRunCount} />
                </Reveal>
              ) : null}

              {/* Where "How you're going" sits on an off day. At the track the last thirty
                  days are not the question — the next change is — so the Engineer takes the
                  slot and the trends wait for the drive home. */}
              <Reveal index={3}>
                <DashboardAskEngineerCard questions={askQuestions} />
              </Reveal>

              <Reveal index={4}>{ideasCard}</Reveal>

              <Reveal index={5}>{thingsToDoCard}</Reveal>
            </>
          ) : (
            <>
              <Reveal index={1}>
                <DashboardNextOutingCard event={nextEvent} />
              </Reveal>

              {/* Ambient momentum was demoted to last on 2026-07-16 and came back up on
                  2026-08-20 as "How you're going" — a session trend per track from the last
                  30 days, which is a read on the driver rather than a scoreboard. */}
              <Reveal index={2}>
                <DashboardSummaryCard summary={summary} records={records} newPb={newPb} />
              </Reveal>

              <Reveal index={3}>
                <DashboardAskEngineerCard questions={askQuestions} />
              </Reveal>

              <Reveal index={4}>{ideasCard}</Reveal>

              <Reveal index={5}>{thingsToDoCard}</Reveal>
            </>
          )}
        </div>
      </section>
    </>
  );
}
