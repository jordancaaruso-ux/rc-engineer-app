import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { getCachedAnalysisHomeModel } from "@/lib/cachedReads";
import { SessionTrendCard } from "@/components/analysis/SessionTrendCardLazy";
import { RecentRunsCard } from "@/components/analysis/RecentRunsCard";
import { TeammatesCard } from "@/components/analysis/TeammatesCard";
import { CardPanel } from "@/components/ui/CardPanel";
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
  const model = await getCachedAnalysisHomeModel(user.id, displayTimeZone);

  return (
    <>
      <header className="page-header is-echo">
        <div className="min-w-0">
          <h1 className="page-title">Analysis</h1>
          <p className="page-subtitle">Your recent form and what&apos;s working.</p>
        </div>
      </header>
      <section className="page-body flex max-w-2xl flex-col gap-3">
        <Reveal index={0}>
          <RecentRunsCard
            runs={model.recentRuns}
            totalRunCount={model.totalRunCount}
            hasTeam={model.hasTeam}
          />
        </Reveal>
        <Reveal index={1}>
          <SessionTrendCard trend={model.trend} />
        </Reveal>
        {/*
          Dropped entirely when there is nobody to stand against AND no team to list, rather than
          drawn empty — see `TeammatesCard`. Two cards on this page is a fine page.
        */}
        {model.teammates ? (
          <Reveal index={2}>
            <TeammatesCard model={model.teammates} />
          </Reveal>
        ) : null}
      </section>
    </>
  );
}
