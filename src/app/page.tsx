import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getCachedDashboardHomeModel } from "@/lib/cachedReads";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { loadOnboardingView } from "@/lib/onboarding/server";
import { loadSetupSheetPrompt } from "@/lib/setup/setupSheetPrompt";
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

  // No takeover anymore (founder 2026-07-22, round 3): a truly-empty account
  // lands HERE, on the real dashboard, with the intro card + guided-intro chip.
  // The app is the tour — docs/ONBOARDING_NORTH_STAR.md.
  const [model, onboarding, setupPrompt] = await Promise.all([
    getCachedDashboardHomeModel(user.id, displayTimeZone),
    loadOnboardingView(user.id),
    loadSetupSheetPrompt(user.id),
  ]);

  return (
    <DashboardHome
      model={model}
      displayTimeZone={displayTimeZone}
      onboarding={onboarding}
      setupPrompt={setupPrompt}
    />
  );
}
