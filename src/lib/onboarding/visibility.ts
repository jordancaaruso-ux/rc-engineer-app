/**
 * First-run visibility rules — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
 *
 * The two onboarding surfaces (welcome overlay, "Get set up" card) are gated by
 * these predicates and nothing else. They lived inline — `loadOnboardingView` for
 * the overlay, `DashboardHome` for the card — until 2026-07-26, when they were
 * pulled out so the state machine can be tested without a database and driven
 * without a fresh account (`/debug/onboarding-preview`).
 *
 * Pure: no Prisma, no React, no env. Everything derives from what the driver
 * actually has — there is no stored step counter.
 */

/** What the driver has. The only input any rule here reads. */
export type OnboardingFacts = {
  /** The welcome overlay was answered once (either button wrote it). */
  seen: boolean;
  /** They tapped Ignore on the Get-set-up card. */
  dismissed: boolean;
  hasCar: boolean;
  hasTimingIdentity: boolean;
  hasSetup: boolean;
  hasAnyRun: boolean;
};

/** Car + timing + setup all in — the card has nothing left to ask for. */
export function isGarageReady(f: OnboardingFacts): boolean {
  return f.hasCar && f.hasTimingIdentity && f.hasSetup;
}

/**
 * The full-screen welcome overlay: a truly-empty account that hasn't answered it.
 * `seen` terminates it unconditionally, so "Look around first" is never a trap —
 * and the car/run checks stop it ambushing anyone who already has data.
 */
export function showWelcomeScreen(f: OnboardingFacts): boolean {
  return !f.seen && !f.hasCar && !f.hasAnyRun;
}

/**
 * The dashboard "Get set up" card. Retires three ways: the garage is ready, the
 * first run is logged (the card's whole purpose, so it stops asking), or Ignore.
 * Note it does NOT depend on `seen` — the card leads whether or not they read the
 * overlay, which is what makes "Look around first" safe.
 */
export function showGetSetUpCard(f: OnboardingFacts): boolean {
  return !f.dismissed && !f.hasAnyRun && !isGarageReady(f);
}
