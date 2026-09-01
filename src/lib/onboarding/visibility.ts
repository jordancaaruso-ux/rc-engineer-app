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
 * A setup sheet is deliberately NOT part of this (founder 2026-08-18, still standing
 * after the 08-26 promotion). It is the one item that needs something they may not
 * have on them — the manufacturer's fillable PDF — so it must never stand between a
 * driver at the track and a logged run. It is step three of the walk with two doors
 * (add it now / add it when you log a run) and carries on nagging from
 * `DashboardAddSetupCard` afterwards, but it does not gate. See `isSetUpComplete`
 * for the "have we finished asking" question, which is not this one.
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
 * All three steps of the walk are done — car, timing identity, setup sheet — so
 * there is nothing left to ask for (2026-08-26).
 *
 * This is what `isGarageReady` used to mean before the 2026-08-18 split. The two
 * are not the same question and both are wanted: `isReadyToRun` answers "can this
 * driver log a run that will work", which the sheet does not affect, and this one
 * answers "have we finished asking", which it does.
 */
export function isSetUpComplete(f: OnboardingFacts): boolean {
  return f.hasCar && f.hasTimingIdentity && f.hasSetup;
}

/**
 * The dashboard "Get set up" card, and — same predicate, no second definition of
 * "still setting up" — the "Back to setting up" row on Settings.
 *
 * Retires three ways: the walk is finished, the first run is logged (the card's
 * whole purpose, so it stops asking), or Ignore.
 *
 * The finished-walk exit came back on 2026-08-26 with the sheet promoted to step
 * three (founder). It was removed on 08-18 for a good reason that no longer holds:
 * back then the card's last state was the payoff — "You're ready, log your first
 * run" — so retiring on a complete garage deleted the card at the moment it finally
 * had good news. That payoff button is gone (the dashboard's yellow Start-a-run bar
 * was always the run door, and two yellow buttons stacked was one too many), so a
 * complete card now shows three ticks and asks for nothing. That is furniture.
 *
 * Note it does NOT depend on `seen` — the card leads whether or not they read the
 * overlay, which is what makes "Look around first" safe.
 */
export function showGetSetUpCard(f: OnboardingFacts): boolean {
  return !f.dismissed && !f.hasAnyRun && !isSetUpComplete(f);
}
