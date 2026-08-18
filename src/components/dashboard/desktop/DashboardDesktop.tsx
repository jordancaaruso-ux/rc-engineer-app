import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardLastRunReadCard } from "@/components/dashboard/DashboardLastRunReadCard";
import { DashboardHeroCard } from "@/components/dashboard/desktop/DashboardHeroCard";
import { DashboardTodayNoLapsCard } from "@/components/dashboard/desktop/DashboardTodayNoLapsCard";
import { DashboardListCard } from "@/components/dashboard/desktop/DashboardListCard";
import { DashboardNextOutingCard } from "@/components/dashboard/desktop/DashboardNextOutingCard";

/**
 * The desktop dashboard (design handoff "Desktop dashboard 1b — timing tower",
 * 2026-08-08). Rendered only at `xl`+; below that the phone stack in `DashboardHome`
 * is what shows, unchanged.
 *
 * A twin render rather than a re-flow, because the two layouts are genuinely different
 * compositions of the same model — the hero's lap numeral, dials and pace chart have no
 * phone equivalent, and the phone's verdict / next-outing cards have no desktop slot.
 * That is the same call `SessionsWorkbench` made.
 *
 * The cost of a twin render is double-mounted client state. `PendingTeamInvitesCard` is
 * therefore hoisted out of both trees and rendered once by `DashboardHome`. The two
 * `ActionItemListPanel`s do mount twice; only one is ever visible, they are seeded from
 * the same server rows, and they can only diverge if the window is resized across 1280px
 * mid-edit. That is the accepted trade — see the note in DashboardHome.
 *
 * ── Re-cut into two rows, 2026-08-18 ────────────────────────────────────────────────
 * The handoff's two columns put three cards on the narrow side and two on the wide side,
 * and the lists are the only thing here that grows with use. Measured on a real account
 * at 1440×900: left column 663px, right column 885px — 75px of Things-to-do below the
 * fold (its Engineer link never on screen without scrolling) beside 231px of empty page
 * under the ledger. The whole document scrolled 85px to finish one narrow column.
 *
 * So three columns, hero spanning the first two:
 *
 *   ┌──────────────────────────────────────┬────────────────┐
 *   │  HERO — lap · dials · chart · strip   │  START RUN     │
 *   │                                       │  NEXT OUTING   │
 *   ├──────────────────┬────────────────────┼────────────────┤
 *   │  LEDGER          │  IDEAS             │  THINGS TO DO  │
 *   └──────────────────┴────────────────────┴────────────────┘
 *      1.18fr               1fr                  1fr
 *
 * The ratio is picked so 1440 lands on 496 / 420 / 420: the hero keeps the exact 936px it
 * has today (two cells plus the gap), and both lists keep the 420px measure they already
 * had, so nothing inside them re-flows. The ledger narrows from 936 to 496, which its
 * name/value rows read better at anyway — they were a short label and a short figure with
 * a quarter-metre of nothing between them. Page comes out ~898px at 1440×900: it fits.
 *
 * Adding the outing card to the OLD right column would have pushed it 60px further past
 * the fold, which is why this is one change and not two.
 */
/**
 * Rows either list shows before collapsing the rest behind a "+N more" line.
 *
 * The point is that the page height stops depending on how many ideas you have. Six is
 * what fits the row without pushing the fold on a 900px viewport; the week you dump
 * twenty ideas in after a bad meeting, the column stays where it is. Phone is untouched —
 * it stacks, so a long list costs a scroll rather than a broken layout.
 */
const DESKTOP_LIST_ROWS = 6;

export function DashboardDesktop({
  model,
  isTrackDay,
  dayStamp,
}: {
  model: DashboardHomeModel;
  isTrackDay: boolean;
  /**
   * "FRI 07 AUG", or "FRI 07 AUG · Off day". Built in `DashboardHome` and shown on
   * whichever card takes the hero slot — it used to sit beside the page title,
   * which is now screen-reader-only on desktop (globals.css, `is-echo`).
   */
  dayStamp: string;
}) {
  const {
    heroPace,
    summary,
    todayContext,
    todayRunCount,
    recentRun,
    todayVerdict,
    todayStrip,
    thingsToTry,
    thingsToDo,
    todayDraftRunId,
    todayDraftSavedAt,
    featuredEvent,
  } = model;

  const activeEvent = featuredEvent?.status === "active" ? featuredEvent : null;
  const outingEvent =
    featuredEvent?.status === "next" || featuredEvent?.status === "active" ? featuredEvent : null;

  // The CTA's footer line: what this run will attach to.
  //
  // It used to carry the event too ("Next out: SA Test") — the only place desktop
  // mentioned a booked race at all. The outing card directly below now says it properly,
  // with the date, so repeating the name here is the same race printed twice in one
  // column. On an off day with no draft there is nothing left to say and the footer is
  // omitted, which is also what shortens the top-right stack enough to hold the new card.
  // While a meeting is running the outing card below already carries today's count, so the
  // footer stands down — the whole point of the card is that this line stops being the only
  // thing desktop knows about the day. A track day with no event booked (plain practice) has
  // no card to carry it, so there it stays.
  const ctaFooter = todayDraftRunId
    ? "Draft in progress · laps and setup captured"
    : isTrackDay && !activeEvent
      ? `${todayRunCount} ${todayRunCount === 1 ? "run" : "runs"} logged today`
      : null;

  return (
    <div className="hidden xl:grid xl:grid-cols-[minmax(0,1.18fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-start xl:gap-5">
      {/* Row 1, left: the pace answer, spanning two of the three columns so it keeps its
          936px at 1440 and nothing about the hero itself changes. */}
      <div className="col-span-2 flex min-w-0 flex-col gap-5">
        {heroPace ? (
          <DashboardHeroCard
            isTrackDay={isTrackDay}
            hero={heroPace}
            summary={summary}
            todayContext={todayContext}
            todayRunCount={todayRunCount}
            recentRun={recentRun}
            lastChange={todayVerdict?.lastChange ?? null}
            dayStamp={dayStamp}
          />
        ) : isTrackDay && todayStrip.length > 0 ? (
          // No lap times anywhere today, so there is no hero to build. The day still has
          // ratings and setup changes in it — show those rather than an empty column.
          <DashboardTodayNoLapsCard
            strip={todayStrip}
            todayContext={todayContext}
            todayRunCount={todayRunCount}
            dayStamp={dayStamp}
          />
        ) : null}
      </div>

      {/* Row 1, right: act, then what you are acting towards. */}
      <div className="flex min-w-0 flex-col gap-5">
        <DashboardStartRunCta
          serverDraftRunId={todayDraftRunId}
          serverDraftSavedAt={todayDraftSavedAt}
          footer={ctaFooter}
        />

        <DashboardNextOutingCard event={outingEvent} todayRunCount={activeEvent ? todayRunCount : 0} />
      </div>

      {/* Row 2: the record, then the two lists. Each cell is narrower than the old right
          column was wide, so no list is stretched by the move. The ledger leads because it
          belongs under the hero it reads from. */}
      <div className="min-w-0">
        <DashboardLastRunReadCard
          run={recentRun}
          headline={isTrackDay ? "Last change" : "Last run read"}
          // On a track day the newest run is usually this same run, and its diff is
          // already the hero's delta note; don't print it a second time.
          showSetupChanges={todayStrip[0]?.runId !== recentRun?.id}
        />
      </div>

      <div className="min-w-0">
        <DashboardListCard
          title="Ideas"
          subtitle="what to try next time out"
          count={thingsToTry.length}
          // No footer any more. It carried "Book your next track day" on every render,
          // including the ones where a track day was already booked and named two cards
          // above it. That link now belongs to the outing card's empty state.
          // Demo walkthrough's last stop. The phone's equivalent is the `things-to-try`
          // anchor, which is a different card — see `tourSteps.ts`.
          dataTour="test-plan"
        >
          <ActionItemListPanel
            list="try"
            title="Ideas"
            addPlaceholder="Add an idea…"
            addLabel="Add an idea"
            initialItems={thingsToTry}
            embedded
            variant="ledger"
            maxVisible={DESKTOP_LIST_ROWS}
          />
        </DashboardListCard>
      </div>

      <div className="min-w-0">
        <DashboardListCard
          title="Things to do"
          count={thingsToDo.length}
          footer={{
            label: isTrackDay ? "Ask the Engineer about today" : "Ask the Engineer what to try",
            href: "/engineer",
            sparkle: true,
          }}
        >
          <ActionItemListPanel
            list="do"
            title="Things to do"
            addPlaceholder="Add a reminder…"
            initialItems={thingsToDo}
            embedded
            variant="ledger"
            maxVisible={DESKTOP_LIST_ROWS}
          />
        </DashboardListCard>
      </div>
    </div>
  );
}
