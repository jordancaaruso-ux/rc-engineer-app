/**
 * First-run visibility rules — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23,
 * amended 2026-08-18).
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

/**
 * Set up enough that logging the run is the next thing to do: a car to attach the
 * run to, and the timing identity that makes lap times land on them by themselves.
 *
 * A setup sheet is deliberately NOT part of this (founder 2026-08-18). It is the
 * one item that needs something they may not have on them — the manufacturer's
 * fillable PDF — and asking for it before the first run puts the app's longest
 * chore in front of its first payoff. It stays on the card as an advised extra and
 * carries on nagging from `DashboardAddSetupCard` afterwards.
 *
 * Was `isGarageReady` (car + timing + setup) until the same call.
 */
export function isReadyToRun(f: OnboardingFacts): boolean {
  return f.hasCar && f.hasTimingIdentity;
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
 * The dashboard "Get set up" card. Retires exactly two ways: the first run is
 * logged (the card's whole purpose, so it stops asking) or Ignore.
 *
 * It no longer retires on a "ready" garage (amended 2026-08-18). Readiness is now
 * car + timing, and the card's last state is the payoff — "You're ready, log your
 * first run" — so retiring on readiness would delete the card at the exact moment
 * it finally has the good news to deliver.
 *
 * Note it does NOT depend on `seen` — the card leads whether or not they read the
 * overlay, which is what makes "Look around first" safe.
 */
export function showGetSetUpCard(f: OnboardingFacts): boolean {
  return !f.dismissed && !f.hasAnyRun;
}
