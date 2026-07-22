import type { OnboardingState } from "@/lib/appSettings";

/**
 * First-run progress — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Deliberately derived from what the driver actually HAS (a name, a car, a
 * home track), not from a stored step counter. A stored counter goes stale the
 * moment someone adds a car from `/cars` instead of following the guide, and
 * then the dashboard nags about work already done. `onboardingCompletedAt` is
 * only ever an override that finishes it early.
 *
 * Steps are the guided-intro walk (founder-locked 2026-07-22, round 3): the
 * guide chip and its highlighted taps steer the driver through the REAL app
 * surfaces — Settings, Cars, Tracks, Tire sets — so setting up IS the tour.
 * "You" folds name + timing identity into one stop because they live on the
 * same Settings card; timing stays required within it (name alone ≠ done).
 *
 * The setup sheet is not a step here on purpose: it is optional and must never
 * gate logging, so it can't hold the garage "unready".
 */

export const ONBOARDING_STEP_IDS = ["you", "car", "track", "tires"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  /** What they've got, when done — otherwise why the step matters. */
  meta: string;
  done: boolean;
  href: string;
};

export type OnboardingProgress = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  /** Garage is ready: every step done, or explicitly marked complete. */
  complete: boolean;
  /** The next thing to do, or null when there's nothing left. */
  nextStep: OnboardingStep | null;
  /** Whether the dashboard should show the resume card. */
  showResumeCard: boolean;
};

export type OnboardingProgressInput = {
  /** Their display name (`myName` setting), if set. */
  name: string | null;
  /** Name as the timing site prints it (`liveRcDriverName`), if set. */
  timingName: string | null;
  /** How many MYLAPS transponder numbers they've saved. */
  transponderCount: number;
  /** They race a club / loaner chip, so there's no number to give. */
  transponderLoaner: boolean;
  /** Name of their first car, if they have one. */
  carName: string | null;
  /** Name of the track on their most recent run / favourite, if any. */
  trackName: string | null;
  /** Name of their first active tire set, if any. */
  tireSetName: string | null;
  state: OnboardingState;
};

/** Enough for lap times to find them: the printed name, plus a chip or a reason there isn't one. */
export function hasTimingIdentity(
  input: Pick<OnboardingProgressInput, "timingName" | "transponderCount" | "transponderLoaner">
): boolean {
  return (
    Boolean(input.timingName?.trim()) && (input.transponderCount > 0 || input.transponderLoaner)
  );
}

export function computeOnboardingProgress(input: OnboardingProgressInput): OnboardingProgress {
  const { name, timingName, transponderCount, transponderLoaner, carName, trackName, tireSetName, state } =
    input;

  const youDone = Boolean(name?.trim()) && hasTimingIdentity(input);
  const youMeta = youDone
    ? [
        name!.trim(),
        transponderLoaner
          ? "club chip"
          : `${transponderCount} transponder${transponderCount === 1 ? "" : "s"}`,
      ].join(" · ")
    : "Your name and timing details, so laps attach on their own";

  const steps: OnboardingStep[] = [
    {
      id: "you",
      title: "Add your name & timing details",
      meta: youMeta,
      done: youDone,
      href: "/settings",
    },
    {
      id: "car",
      title: "Add your car",
      meta: carName?.trim() || "Nothing logs without one",
      done: Boolean(carName?.trim()),
      href: "/cars",
    },
    {
      id: "track",
      title: "Pick your home track",
      meta: trackName?.trim() || "So runs can be compared",
      done: Boolean(trackName?.trim()),
      href: "/tracks",
    },
    {
      id: "tires",
      title: "Add a tire set",
      meta: tireSetName?.trim() || "Wear tracks itself from run 1",
      done: Boolean(tireSetName?.trim()),
      href: "/tire-sets",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const complete = allDone || state.completed;
  const nextStep = steps.find((s) => !s.done) ?? null;

  return {
    steps,
    doneCount,
    total: steps.length,
    complete,
    nextStep,
    // Dismissing is permanent (founder 2026-07-22: "keep it but able to click
    // ignore"). A finished garage hides it too, so it can never outlive its use.
    showResumeCard: !complete && !state.resumeDismissed,
  };
}
