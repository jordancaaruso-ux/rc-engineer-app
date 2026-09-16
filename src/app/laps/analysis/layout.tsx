import type { ReactNode } from "react";
import { isFeatureLockedForCurrentUser } from "@/lib/entitlementGuards";
import { upgradeTierFor } from "@/lib/entitlementLogic";
import { ProLockedPanel } from "@/components/billing/ProLockedPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

/**
 * Lap time analysis is Notebook's (founder call 2026-09-15), so a Starter member meets this room
 * locked: the same visible-but-locked twin the Geometry Lab and the Engineer have. The check sits
 * in the segment layout for the Lab's reason: one gate covers every state of the route (the
 * library, `?session=`, `?run=`) and `/laps/import`, which redirects here.
 *
 * Tools draws the same lock on its own bench (`LockedBench`), so the usual way in never opens
 * onto this page. It is for the other doors: a run's "Detailed analysis", an old link.
 *
 * Only the reading room is locked. Laps still come in on the run form on every plan, and a run's
 * own lap sheet (its pop-up) is session review, which Starter keeps.
 */
export default async function LapAnalysisLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  if (await isFeatureLockedForCurrentUser("lap-analysis")) {
    return (
      <>
        {/* Hardwired to Tools, like the Lab's locked twin: a layout can't read the page's
            params, and Tools is this room's own dock cell. */}
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/tools" />
            <div>
              <h1 className="page-title">Lap time analysis</h1>
            </div>
          </div>
        </header>
        <ProLockedPanel
          title="Lap time analysis"
          blurb="Any timing sheet, every driver, lap by lap: a race you drove, a teammate's practice, a meeting on the other side of the world."
          includedIn={upgradeTierFor("lap-analysis")}
        />
      </>
    );
  }
  return <>{children}</>;
}
