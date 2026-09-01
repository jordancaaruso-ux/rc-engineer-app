import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getCachedAnalysisHomeModel } from "@/lib/cachedReads";
import { AnalysisOutingCard } from "@/components/analysis/AnalysisOutingCard";
import { TeammatesCard } from "@/components/analysis/TeammatesCard";
import { loadAnalysisOuting } from "@/lib/analysis/loadAnalysisOuting";
import type { Run } from "@/components/runs/RunDetailPanel";
import { CardPanel } from "@/components/ui/CardPanel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Analysis debrief — the "review the day" surface: the last runs, the session trend chart, and
 * who else was out with you.
 *
 * The setup-comparison and Geometry Lab doors came off on 2026-08-19. They were here because the
 * phone had no other way to reach the benches — Tools was a desktop-only tab — so a page about
 * reviewing what happened ended with a toolbox stapled to it. Tools has its own dock cell now,
 * and this page is one thing again.
 *
 * The video card came off the same day and for the same reason (founder pin on this page): Tools
 * already carries a full Video band over the same job list, so this was the second and smaller
 * front door to one queue. `TeammatesCard` took the slot, and it is the only card here that looks
 * outward: the drivers at your last shared meeting and how you compare, then every teammate you
 * have by how recently they ran. Two scopes, deliberately — the card carries the reasoning.
 */
export default async function AnalysisHubPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div>
            <h1 className="page-title">Analysis</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="type-machine">DATABASE_URL</span> in{" "}
            <span className="type-machine">.env</span> to load your analysis.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, displayTimeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);
  /*
   * The outing is NOT cached alongside the home model, deliberately: it carries whole
   * run records (dates, lap JSON, setup ids) and `unstable_cache` round-trips them
   * through its own serializer, which would hand the client strings where the types
   * promise `Date`. Three queries on a page that already runs several is the cheaper
   * side of that trade.
   */
  const [model, outing] = await Promise.all([
    getCachedAnalysisHomeModel(user.id, displayTimeZone),
    loadAnalysisOuting(user.id, displayTimeZone ?? "UTC"),
  ]);
  const runsById = new Map<string, Run>((outing?.runs ?? []).map((run) => [run.id, run as Run]));

  return (
    <>
      <header className="page-header is-echo">
        <div className="min-w-0">
          <h1 className="page-title">Analysis</h1>
          <p className="page-subtitle">Your recent form and what&apos;s working.</p>
        </div>
      </header>
      <section className="page-body flex max-w-2xl flex-col gap-3">
        {/*
          One card, not two: the outing names itself, and the picture of it sits
          inside, under that name.

          The trend goes down as DATA, not as a rendered chart (2026-08-25). Built
          here it was a finished picture the card could not talk to — so a point and
          a row, always the same run, behaved as two different things: the row
          unfolded in place and the point navigated away. The card mounts it
          `compact` + `bare` itself and wires both directions; `AnalysisOutingCard`
          carries the reasoning.
        */}
        {outing ? (
          <Reveal index={0}>
            <AnalysisOutingCard
              title={outing.title}
              where={outing.where}
              rows={outing.rows}
              runsById={runsById}
              displayTimeZone={displayTimeZone}
              outingTimeZone={outing.timeZone}
              pickerRuns={outing.pickerRuns}
              totalRunCount={model.totalRunCount}
              hasTeam={model.hasTeam}
              trend={outing.trend}
            />
          </Reveal>
        ) : (
          <Reveal index={0}>
            <CardPanel contentClassName="flex flex-col gap-3 p-4">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                No runs yet. Your next time at the track lands here — the day&apos;s trend, every
                run on it, and what changed on the car between them.
              </p>
              <ButtonLink href="/runs/new" className="self-start">
                Log your first run
              </ButtonLink>
            </CardPanel>
          </Reveal>
        )}
        {/*
          Two more cards — the pace standing at your last shared meeting, then your team — or
          neither. Dropped entirely when there is nobody to stand against AND no team to list,
          rather than drawn empty; see `TeammatesCard`, which also carries why those are two cards
          and not two halves of one.

          They sit last so the standing's heading breaks the fold on a 390px phone. The outing
          above spends everything from the rail to ~750px — chart included — and that budget is
          why the chart is the compact one and why the run list shows three. Anything added above
          here comes out of the same purse.
        */}
        {model.teammates ? (
          <Reveal index={1}>
            <TeammatesCard model={model.teammates} />
          </Reveal>
        ) : null}
      </section>
    </>
  );
}
