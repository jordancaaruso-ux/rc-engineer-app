import type { ReactNode } from "react";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { getCachedDashboardHomeModel } from "@/lib/cachedReads";
import { getEntitlement } from "@/lib/entitlement";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { loadOnboardingView } from "@/lib/onboarding/server";
import { canLookUpTimingSessionsForUser } from "@/lib/onboarding/timingIdentity";
import { loadDashboardSetups } from "@/lib/setup/getDashboardSetups";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { UnloggedRunsSheet } from "@/components/dashboard/GetMyDay";
import { CardPanel } from "@/components/ui/CardPanel";

export default async function DashboardPage({
  searchParams,
}: {
  /** `?unlogged=<trackId>&ymd=<ymd>` — the 8 pm notification's landing when the driver has no run
   *  that day to open. The sheet lists the runs they didn't log here, then lands on the day it makes. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const sp = (await searchParams) ?? {};
  const unloggedRaw = sp.unlogged;
  const unloggedTrackId =
    typeof unloggedRaw === "string" && unloggedRaw.trim() ? unloggedRaw.trim() : null;
  const ymdRaw = sp.ymd;
  const unloggedYmd = typeof ymdRaw === "string" && ymdRaw.trim() ? ymdRaw.trim() : null;

  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header is-echo">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set <span className="type-machine">DATABASE_URL</span> in <span className="type-machine">.env</span>{" "}
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
  // and setup writes don't bust it, so the "add a setup" card would linger for half a minute after
  // the driver just added one.
  const [model, onboarding, setups, entitlement, canLookUpSessions] = await Promise.all([
    getCachedDashboardHomeModel(user.id, displayTimeZone),
    loadOnboardingView(user.id),
    loadDashboardSetups(user.id),
    getEntitlement(user),
    canLookUpTimingSessionsForUser(user.id),
  ]);

  // "Get my day" reads the timing sites as this driver, so it needs a plan and something to match
  // them by: a LiveRC name or their own transponder — the sweep's rule, looser than the Get-set-up
  // card's. The demo is read-only, so there it would be a dead button.
  const showGetMyDay = entitlement.entitled && canLookUpSessions && !isDemoIdentity(user);

  return (
    <>
      {unloggedTrackId && unloggedYmd ? (
        <UnloggedRunsSheet trackId={unloggedTrackId} ymd={unloggedYmd} />
      ) : null}
      <DashboardHome
        model={model}
        displayTimeZone={displayTimeZone}
        onboarding={onboarding}
        setups={setups}
        showGetMyDay={showGetMyDay}
      />
    </>
  );
}
