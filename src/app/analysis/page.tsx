import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { loadAnalysisHomeModel } from "@/lib/analysis/loadAnalysisHomeModel";
import { SessionTrendCard } from "@/components/analysis/SessionTrendCard";
import { RecentRunsCard } from "@/components/analysis/RecentRunsCard";
import { AnalysisVideoCard } from "@/components/analysis/AnalysisVideoCard";
import { HubNavLink } from "@/components/layout/HubNavLink";
import { ANALYSIS_HUB_LINKS } from "@/components/layout/navConfig";
import { CardPanel } from "@/components/ui/CardPanel";
import { Reveal } from "@/components/ui/Reveal";

/**
 * Analysis debrief — the "review the day" surface: session trend chart,
 * last four runs, latest video analysis, and the setup-comparison door.
 */
export default async function AnalysisHubPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Analysis</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in{" "}
            <span className="font-mono">.env</span> to load your analysis.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, displayTimeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);
  const model = await loadAnalysisHomeModel(user.id, displayTimeZone);

  const toolDoorLinks = ANALYSIS_HUB_LINKS.filter(
    (link) => link.href === "/setup/comparison" || link.href === "/analysis/roll-center"
  );

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Analysis</h1>
          <p className="page-subtitle">Your recent form and what&apos;s working.</p>
        </div>
      </header>
      <section className="page-body flex max-w-2xl flex-col gap-3">
        <Reveal index={0}>
          <RecentRunsCard runs={model.recentRuns} />
        </Reveal>
        <Reveal index={1}>
          <SessionTrendCard trend={model.trend} />
        </Reveal>
        <Reveal index={2}>
          <AnalysisVideoCard video={model.video} />
        </Reveal>
        {toolDoorLinks.length > 0 ? (
          <Reveal index={3}>
            <ul className="flex flex-col gap-2.5">
              {toolDoorLinks.map((link) => (
                <HubNavLink key={link.href} link={link} />
              ))}
            </ul>
          </Reveal>
        ) : null}
      </section>
    </>
  );
}
