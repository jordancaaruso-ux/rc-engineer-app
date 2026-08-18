/**
 * Run: `npm run test:onboarding`
 *
 * Locks the first-run state machine (docs/ONBOARDING_NORTH_STAR.md). These rules
 * are otherwise only observable by creating a brand-new account, so they're the
 * easiest thing in the app to regress silently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isReadyToRun,
  showGetSetUpCard,
  showWelcomeScreen,
  type OnboardingFacts,
} from "@/lib/onboarding/visibility";

/** A brand-new account: nothing done, nothing seen. */
const EMPTY: OnboardingFacts = {
  seen: false,
  dismissed: false,
  hasCar: false,
  hasTimingIdentity: false,
  hasSetup: false,
  hasAnyRun: false,
};

const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ ...EMPTY, ...over });

test("brand-new account gets both surfaces", () => {
  assert.equal(showWelcomeScreen(EMPTY), true);
  assert.equal(showGetSetUpCard(EMPTY), true);
});

test("the overlay never returns once answered, but the card still leads", () => {
  const seen = facts({ seen: true });
  assert.equal(showWelcomeScreen(seen), false);
  assert.equal(
    showGetSetUpCard(seen),
    true,
    "'Look around first' must not also dismiss the card — that would leave a new account with no guidance"
  );
});

test("the overlay never ambushes an account that already has data", () => {
  // `seen` is false for every account created before the overlay shipped.
  assert.equal(showWelcomeScreen(facts({ hasCar: true })), false);
  assert.equal(showWelcomeScreen(facts({ hasAnyRun: true })), false);
});

test("the first run retires the card, even with the garage half-done", () => {
  assert.equal(showGetSetUpCard(facts({ hasCar: true, hasAnyRun: true })), false);
  assert.equal(
    showGetSetUpCard(facts({ hasAnyRun: true })),
    false,
    "logging a run is the card's whole purpose — it stops asking once that happened"
  );
});

test("Ignore retires the card and only the card", () => {
  assert.equal(showGetSetUpCard(facts({ dismissed: true })), false);
  assert.equal(showWelcomeScreen(facts({ dismissed: true })), true);
});

test("the card persists while anything is still missing", () => {
  assert.equal(showGetSetUpCard(facts({ hasCar: true })), true);
  assert.equal(
    showGetSetUpCard(facts({ hasCar: true, hasSetup: true })),
    true,
    "timing still outstanding"
  );
});

/*
 * Amended 2026-08-18. Readiness used to require a setup sheet AND retire the card;
 * both were wrong. A driver at the track without the manufacturer's PDF is ready to
 * run, and the card's readiness state is the payoff, so retiring on it deleted the
 * good news at the moment it arrived.
 */
test("a car plus timing is ready — the setup sheet does not gate the run", () => {
  const ready = facts({ hasCar: true, hasTimingIdentity: true });
  assert.equal(isReadyToRun(ready), true);
  assert.equal(isReadyToRun(facts({ hasCar: true, hasTimingIdentity: true, hasSetup: true })), true);
});

test("readiness needs both the car and the timing identity", () => {
  assert.equal(isReadyToRun(facts({ hasCar: true })), false);
  assert.equal(isReadyToRun(facts({ hasTimingIdentity: true })), false);
  assert.equal(
    isReadyToRun(facts({ hasCar: true, hasSetup: true })),
    false,
    "a sheet is not a substitute for the timing identity"
  );
});

test("the ready card stays up until the run is logged", () => {
  const ready = facts({ seen: true, hasCar: true, hasTimingIdentity: true, hasSetup: true });
  assert.equal(
    showGetSetUpCard(ready),
    true,
    "its last state is 'You're ready — log your first run'; retiring here hides the payoff"
  );
  assert.equal(showGetSetUpCard({ ...ready, hasAnyRun: true }), false);
});
