import { prisma } from "@/lib/prisma";
import { getOnboardingState } from "@/lib/appSettings";
import { getTimingIdentityForUser } from "@/lib/onboarding/timingIdentity";
import { userHasAnySetup } from "@/lib/setup/setupSheetPrompt";

/**
 * First-run readiness view — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
 *
 * The old 4-step guide (you/car/track/tires) + floating guide chip is gone. Only a
 * CAR is truly required to log a run; timing identity and a setup are strongly
 * advised but never gate. Everything here is DERIVED from what the driver actually
 * has, so each surface (the welcome overlay, the dashboard "Get set up" card)
 * self-retires — there is no stored step counter.
 */
export type OnboardingView = {
  /** The welcome overlay was answered once (either button) — it never shows twice. */
  seen: boolean;
  /** They tapped Ignore on the Get-set-up card — it never returns. */
  dismissed: boolean;
  hasCar: boolean;
  /** First car id, for the row links + the adaptive setup flow. */
  carId: string | null;
  hasTimingIdentity: boolean;
  hasSetup: boolean;
  /** At least one run logged — the card's natural end. */
  hasAnyRun: boolean;
  /** Truly-empty account that hasn't met the welcome screen yet. */
  showIntro: boolean;
};

export async function loadOnboardingView(userId: string): Promise<OnboardingView> {
  const [state, car, anyRun, hasTiming, hasSetup] = await Promise.all([
    getOnboardingState(userId),
    prisma.car.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    prisma.run.findFirst({ where: { userId }, select: { id: true } }),
    getTimingIdentityForUser(userId),
    userHasAnySetup(userId),
  ]);

  const hasCar = car != null;
  const hasAnyRun = anyRun != null;
  return {
    seen: state.seen,
    dismissed: state.resumeDismissed,
    hasCar,
    carId: car?.id ?? null,
    hasTimingIdentity: hasTiming,
    hasSetup,
    hasAnyRun,
    // The welcome overlay: a brand-new account that hasn't answered it and has
    // nothing yet. `seen` terminates it so "Look around" is never a trap.
    showIntro: !state.seen && !hasCar && !hasAnyRun,
  };
}
