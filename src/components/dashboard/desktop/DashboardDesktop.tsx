import type { DashboardHomeModel } from "@/lib/dashboardServer";
import { ActionItemListPanel } from "@/components/dashboard/ActionItemListPanel";
import { DashboardStartRunCta } from "@/components/dashboard/DashboardStartRunCta";
import { DashboardLastRunReadCard } from "@/components/dashboard/DashboardLastRunReadCard";
import { DashboardHeroCard } from "@/components/dashboard/desktop/DashboardHeroCard";
import { DashboardTodayNoLapsCard } from "@/components/dashboard/desktop/DashboardTodayNoLapsCard";
import { DashboardListCard } from "@/components/dashboard/desktop/DashboardListCard";

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
 */
export function DashboardDesktop({
  model,
  isTrackDay,
}: {
  model: DashboardHomeModel;
  isTrackDay: boolean;
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

  // The CTA's new footer line: what the run will attach to, or what is missing.
  const ctaFooter = todayDraftRunId
    ? "Draft in progress · laps and setup captured"
    : isTrackDay
      ? `${todayRunCount} ${todayRunCount === 1 ? "run" : "runs"} logged today`
      : featuredEvent?.status === "next"
        ? `Next out: ${featuredEvent.name}`
        : "Nothing booked — log a practice session";

  return (
    <div className="hidden xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        {heroPace ? (
          <DashboardHeroCard
            isTrackDay={isTrackDay}
            hero={heroPace}
            summary={summary}
            todayContext={todayContext}
            todayRunCount={todayRunCount}
            recentRun={recentRun}
            lastChange={todayVerdict?.lastChange ?? null}
          />
        ) : isTrackDay && todayStrip.length > 0 ? (
          // No lap times anywhere today, so there is no hero to build. The day still has
          // ratings and setup changes in it — show those rather than an empty column.
          <DashboardTodayNoLapsCard
            strip={todayStrip}
            todayContext={todayContext}
            todayRunCount={todayRunCount}
          />
        ) : null}

        <DashboardLastRunReadCard
          run={recentRun}
          headline={isTrackDay ? "Last change" : "Last run read"}
          // On a track day the newest run is usually this same run, and its diff is
          // already the hero's delta note; don't print it a second time.
          showSetupChanges={todayStrip[0]?.runId !== recentRun?.id}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <DashboardStartRunCta
          serverDraftRunId={todayDraftRunId}
          serverDraftSavedAt={todayDraftSavedAt}
          footer={ctaFooter}
        />

        <DashboardListCard
          title="Test plan"
          subtitle="what to try next time out"
          count={thingsToTry.length}
          footer={{ label: "Book your next track day", href: "/events" }}
          // Demo walkthrough's last stop. The phone's equivalent is the `things-to-try`
          // anchor, which is a different card — see `tourSteps.ts`.
          dataTour="test-plan"
        >
          <ActionItemListPanel
            list="try"
            title="Test plan"
            addPlaceholder="Add something to test…"
            initialItems={thingsToTry}
            embedded
            variant="ledger"
          />
        </DashboardListCard>

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
          />
        </DashboardListCard>
      </div>
    </div>
  );
}
