/**
 * Copy + state machine behind the Log Run tire-age control.
 *
 * The panel asks one question in two steps: are these the same tires as last run,
 * or did different rubber go on? Only the second branch needs a follow-up (brand
 * new vs a used set), and only the used branch needs a number.
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
      title: "Which set went on?",
      sub: "Pick brand new or used above",
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

/** Label inside the stepper — words, never a bare numeral that reads as an index. */
export function tireCountLabel(runsCompleted: number): string {
  return runsCompleted === 0 ? "New" : runs(runsCompleted);
}
