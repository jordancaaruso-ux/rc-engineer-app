/**
 * Copy + state machine behind the Log Run tire-age control.
 *
 * The panel asks one question: same as the previous run, or a different set? A
 * different set drops straight to how many runs are on it — "brand new" is just
 * the zero on that row, not a step of its own. A car with no previous run has
 * nothing to be the same as, so it skips the question and starts at the count.
 *
 * `runsCompleted: 0, ageKnown: true, stintId: null` is ambiguous on its own — it
 * is both "brand new set" and "nothing answered yet". That is why the choice is
 * tracked separately from the value instead of derived from it every render;
 * `deriveTireChoice` is only the starting point, used when the value arrives from
 * outside (form hydration, prefill, car change).
 */

import type { TireStintValue } from "@/lib/tires/tireStintValue";

/**
 * - `same` — carrying the previous stint on; saving adds one run to it.
 * - `different` — different rubber went on, but new-or-used is still unanswered.
 * - `new` / `used` — the answer to that follow-up.
 * - `null` — nothing answered yet (first run on a car, nothing to carry).
 */
export type TireChoice = "same" | "different" | "new" | "used" | null;

export type TireAgeReadout = {
  title: string;
  sub: string;
  /** True while the readout is a question rather than a state worth trusting. */
  unresolved: boolean;
};

export function isDifferentTires(choice: TireChoice): boolean {
  return choice === "different" || choice === "new" || choice === "used";
}

/**
 * Best reading of a value handed in from outside. Anything with a stint, a
 * count, or an explicit "not sure" has already been answered; a bare zero has
 * not, so the driver gets asked rather than shown an invented "run 1".
 */
export function deriveTireChoice(value: TireStintValue): TireChoice {
  if (!value.ageKnown) return "used";
  if (value.stintId != null) return "same";
  if (value.runsCompleted > 0) return "same";
  return null;
}

function runs(n: number): string {
  return `${n} run${n === 1 ? "" : "s"}`;
}

export function tireAgeReadout(choice: TireChoice, value: TireStintValue): TireAgeReadout {
  if (choice === null) {
    return {
      title: "Not set yet",
      sub: "New tires, or a set you've already run?",
      unresolved: true,
    };
  }
  if (choice === "different") {
    return {
      title: "How many runs are on them?",
      sub: "Tap a number above",
      unresolved: true,
    };
  }
  if (!value.ageKnown) {
    return {
      title: "Age unknown",
      sub:
        value.runsCompleted === 0
          ? "first run since you got them"
          : `${runs(value.runsCompleted)} since you got them`,
      unresolved: false,
    };
  }
  if (value.runsCompleted === 0) {
    return {
      title: "New tires",
      sub: "no runs on them yet — this will be run 1",
      unresolved: false,
    };
  }
  return {
    title: `${runs(value.runsCompleted)} on these`,
    sub: `this will be run ${value.runsCompleted + 1}`,
    unresolved: false,
  };
}

/**
 * The always-visible count row. 0-3 covers the top-mod racer who only ever cares
 * about runs 1-2-3; `4+` hands the club racer over to the stepper rather than
 * spilling a second line of chips on a phone.
 */
export type TireCountChip = {
  key: string;
  label: string;
  runsCompleted: number;
  ageKnown: boolean;
  /** Opens the stepper instead of being an exact answer on its own. */
  opensStepper?: boolean;
};

export const TIRE_COUNT_CHIPS: readonly TireCountChip[] = [
  { key: "new", label: "New", runsCompleted: 0, ageKnown: true },
  { key: "1", label: "1", runsCompleted: 1, ageKnown: true },
  { key: "2", label: "2", runsCompleted: 2, ageKnown: true },
  { key: "3", label: "3", runsCompleted: 3, ageKnown: true },
  { key: "more", label: "4+", runsCompleted: 4, ageKnown: true, opensStepper: true },
  { key: "unsure", label: "Not sure", runsCompleted: 0, ageKnown: false },
];

/** Lowest count `4+` can mean — picking it never *reduces* an existing answer. */
export const TIRE_COUNT_STEPPER_FLOOR = 4;

/**
 * Which chip the current value reads as, or null when the row has no answer to
 * show — nothing chosen yet, or a carried set the row isn't even rendered for.
 */
export function activeTireCountChip(choice: TireChoice, value: TireStintValue): string | null {
  if (choice === null || choice === "different" || choice === "same") return null;
  if (!value.ageKnown) return "unsure";
  if (value.runsCompleted >= TIRE_COUNT_STEPPER_FLOOR) return "more";
  return value.runsCompleted === 0 ? "new" : String(value.runsCompleted);
}

/** Label inside the stepper — words, never a bare numeral that reads as an index. */
export function tireCountLabel(runsCompleted: number): string {
  return runsCompleted === 0 ? "New" : runs(runsCompleted);
}
