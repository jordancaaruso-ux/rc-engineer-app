import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getCachedDashboardHomeModel } from "@/lib/cachedReads";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { loadOnboardingView } from "@/lib/onboarding/server";
import { loadDashboardSetups } from "@/lib/setup/getDashboardSetups";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { CardPanel } from "@/components/ui/CardPanel";

export default async function DashboardPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in <span className="font-mono">.env</span>{" "}
            to load your dashboard.
          </CardPanel>
        </section>
      </>
    );
  }

  const [user, displayTimeZone] = await Promise.all([
    requireCurrentUser(),
    getExplicitTimeZoneForRunFormatting(),
  ]);

  // A truly-empty account lands HERE, on the real dashboard: the welcome overlay
  // covers it once, then the "Get set up" card walks the real surfaces. Only a
  // car is required — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
  // Setups stay OUT of the cached model: that read is tagged `dashboardTag` with a 30s revalidate
  // and setup edits don't bust it, so a change you just saved wouldn't show for half a minute.
  const [model, onboarding, setups] = await Promise.all([
    getCachedDashboardHomeModel(user.id, displayTimeZone),
    loadOnboardingView(user.id),
    loadDashboardSetups(user.id, displayTimeZone),
  ]);

  return (
    <DashboardHome
      model={model}
      displayTimeZone={displayTimeZone}
      onboarding={onboarding}
      setups={setups}
    />
  );
}
