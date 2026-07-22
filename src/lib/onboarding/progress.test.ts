/**
 * Run: `npm run test:onboarding`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OnboardingState } from "@/lib/appSettings";
import { parseOnboardingSkippedSteps } from "@/lib/appSettings";
import {
  computeOnboardingProgress,
  hasTimingIdentity,
  type OnboardingProgressInput,
} from "@/lib/onboarding/progress";

const freshState: OnboardingState = {
  completed: false,
  completedAt: null,
  skippedSteps: [],
  resumeDismissed: false,
  seen: false,
};

function input(partial: Partial<OnboardingProgressInput> = {}): OnboardingProgressInput {
  return {
    name: null,
    timingName: null,
    transponderCount: 0,
    transponderLoaner: false,
    carName: null,
    trackName: null,
    tireSetName: null,
    state: freshState,
    ...partial,
  };
}

/** The "You" step satisfied — name + timing identity. */
const you = { name: "Jordan Caruso", timingName: "Jordan Caruso", transponderCount: 1 } as const;

test("brand new account: nothing done, You is next, resume card shows", () => {
  const p = computeOnboardingProgress(input());
  assert.equal(p.doneCount, 0);
  assert.equal(p.total, 4);
  assert.equal(p.complete, false);
  assert.equal(p.nextStep?.id, "you");
  assert.equal(p.showResumeCard, true);
});

test("You step needs name AND timing identity, not just a name", () => {
  const nameOnly = computeOnboardingProgress(input({ name: "Jordan" }));
  assert.equal(nameOnly.nextStep?.id, "you", "a bare name is not a timing identity");
  const done = computeOnboardingProgress(input({ ...you }));
  assert.equal(done.steps[0]!.done, true);
  assert.equal(done.nextStep?.id, "car");
});

test("club/loaner chip satisfies the transponder half of You", () => {
  assert.equal(
    hasTimingIdentity({ timingName: "Jordan", transponderCount: 0, transponderLoaner: true }),
    true
  );
  assert.equal(
    hasTimingIdentity({ timingName: null, transponderCount: 3, transponderLoaner: false }),
    false,
    "transponders without a timing name still can't match laps"
  );
});

test("steps report what they've got once done", () => {
  const p = computeOnboardingProgress(
    input({ ...you, carName: "Awesomatix A800RR", tireSetName: "Volante V5 36R" })
  );
  const byId = Object.fromEntries(p.steps.map((s) => [s.id, s]));
  assert.equal(byId.you.done, true);
  assert.match(byId.you.meta, /Jordan Caruso/);
  assert.equal(byId.car.meta, "Awesomatix A800RR");
  assert.equal(byId.track.done, false);
  assert.equal(byId.tires.meta, "Volante V5 36R");
  assert.equal(p.nextStep?.id, "track");
  assert.equal(p.doneCount, 3);
});

test("all four present → complete, card gone, no next step", () => {
  const p = computeOnboardingProgress(
    input({ ...you, carName: "A800RR", trackName: "Boronia RC Raceway", tireSetName: "V5 36R" })
  );
  assert.equal(p.complete, true);
  assert.equal(p.nextStep, null);
  assert.equal(p.showResumeCard, false);
});

test("whitespace-only values do not count as done", () => {
  const p = computeOnboardingProgress(input({ name: "   ", carName: "\t", tireSetName: " " }));
  assert.equal(p.doneCount, 0);
  assert.equal(p.nextStep?.id, "you");
});

test("Ignore hides the card but does not fake completion", () => {
  const p = computeOnboardingProgress(
    input({ state: { ...freshState, resumeDismissed: true } })
  );
  assert.equal(p.showResumeCard, false);
  assert.equal(p.complete, false, "dismissing is a UI choice, not progress");
});

test("explicit completedAt completes even with steps outstanding", () => {
  const p = computeOnboardingProgress(
    input({ state: { ...freshState, completed: true, completedAt: "2026-07-22T00:00:00.000Z" } })
  );
  assert.equal(p.complete, true);
  assert.equal(p.showResumeCard, false);
  assert.equal(p.doneCount, 0, "derived progress is untouched by the override");
});

test("adding a car outside the guide advances progress", () => {
  // The regression this guards: a stored step counter would still say "add your
  // car" after someone added one from /cars without following the yellow ring.
  const before = computeOnboardingProgress(input({ ...you }));
  const after = computeOnboardingProgress(input({ ...you, carName: "Xray X4" }));
  assert.equal(before.nextStep?.id, "car");
  assert.equal(after.nextStep?.id, "track");
});

test("having seen the intro does not hide the resume card", () => {
  // "seen" only stops the dashboard intro card from re-appearing. If it ever
  // starts counting as progress, dismissing the intro would strand a new
  // driver with no route back into the guide.
  const p = computeOnboardingProgress(input({ state: { ...freshState, seen: true } }));
  assert.equal(p.showResumeCard, true);
  assert.equal(p.complete, false);
});

test("step hrefs point at the real surfaces the guide walks", () => {
  const p = computeOnboardingProgress(input());
  assert.deepEqual(
    p.steps.map((s) => s.href),
    ["/settings", "/cars", "/tracks", "/tire-sets"]
  );
});

test("skipped-steps parsing tolerates junk", () => {
  assert.deepEqual(parseOnboardingSkippedSteps(null), []);
  assert.deepEqual(parseOnboardingSkippedSteps("not json"), []);
  assert.deepEqual(parseOnboardingSkippedSteps('{"a":1}'), []);
  assert.deepEqual(parseOnboardingSkippedSteps('["sheet","bogus","sheet"]'), ["sheet"]);
  assert.deepEqual(parseOnboardingSkippedSteps('["sheet","track"]'), ["sheet", "track"]);
});
