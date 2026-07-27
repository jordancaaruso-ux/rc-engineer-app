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
  isGarageReady,
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

test("the card persists while timing or setup is still missing", () => {
  assert.equal(showGetSetUpCard(facts({ hasCar: true })), true);
  assert.equal(
    showGetSetUpCard(facts({ hasCar: true, hasTimingIdentity: true })),
    true,
    "setup still outstanding"
  );
  assert.equal(
    showGetSetUpCard(facts({ hasCar: true, hasSetup: true })),
    true,
    "timing still outstanding"
  );
});

test("a ready garage retires the card without a run being logged", () => {
  const ready = facts({ hasCar: true, hasTimingIdentity: true, hasSetup: true });
  assert.equal(isGarageReady(ready), true);
  assert.equal(showGetSetUpCard(ready), false);
});

test("garage readiness needs all three — a car alone is not ready", () => {
  assert.equal(isGarageReady(facts({ hasCar: true })), false);
  assert.equal(isGarageReady(facts({ hasTimingIdentity: true, hasSetup: true })), false);
});
