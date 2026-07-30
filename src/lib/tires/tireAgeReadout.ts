/**
 * Copy + chip table behind the Log Run tire control.
 *
 * The panel asks one question — which compound? — and the age answers itself
 * from the car's last run (`deriveTireStint.ts` holds those rules). So there is
 * no "same or different set?" step any more, and no state where the driver has
 * half-answered: a compound is either picked, or nothing is.
 *
 * That makes the carry-over silent, which is the one thing the previous design
 * refused to do. The mitigation is `tireAgeHint` — a grey line under the chips
 * that names where the number came from. A wrong guess is then one tap to fix,
 * which is cheaper than the question it replaced.
 *
 * The count row is always on screen for the same reason: it is both the display
 * of the guess and the correction for it.
 */

import type { LastRunTires, TireAgeSource, TireStintValue } from "@/lib/tires/tireStintValue";

export type TireAgeReadout = {
  title: string;
  sub: string;
  /** True while the readout is a question rather than a state worth trusting. */
  unresolved: boolean;
};

function runs(n: number): string {
  return `${n} run${n === 1 ? "" : "s"}`;
}

export function tireAgeReadout(source: TireAgeSource, value: TireStintValue): TireAgeReadout {
  if (source === null) {
    return {
      title: "Not set yet",
      sub: "Pick a compound above",
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
 * The line under the chips. Says where the count came from so a carried number
 * is never mistaken for one the driver entered — and says nothing once they have
 * corrected it, because then they already know.
 */
export function tireAgeHint(source: TireAgeSource, last: LastRunTires | null): string | null {
  if (source === "carried") {
    return last && !last.tireAgeKnown
      ? "Carried on from your last run — age still unknown"
      : "Carried on from your last run";
  }
  if (source === "assumedFresh") {
    return last
      ? "Different compound to your last run, so assumed a fresh set"
      : "No previous run on this car, so assumed a fresh set";
  }
  return null;
}

/**
 * The always-visible count row. 0-3 covers the top-mod racer who only ever cares
 * about runs 1-2-3; `4+` grows the row in place rather than spilling a second
 * line of chips on a phone.
 */
export type TireCountChip = {
  key: string;
  label: string;
  runsCompleted: number;
  ageKnown: boolean;
  /** Grows the row instead of being an exact answer on its own. */
  expands?: boolean;
};

const NEW_CHIP: TireCountChip = { key: "new", label: "New", runsCompleted: 0, ageKnown: true };
const UNSURE_CHIP: TireCountChip = {
  key: "unsure",
  label: "Not sure",
  runsCompleted: 0,
  ageKnown: false,
};

export const TIRE_COUNT_CHIPS: readonly TireCountChip[] = [
  NEW_CHIP,
  { key: "1", label: "1", runsCompleted: 1, ageKnown: true },
  { key: "2", label: "2", runsCompleted: 2, ageKnown: true },
  { key: "3", label: "3", runsCompleted: 3, ageKnown: true },
  { key: "more", label: "4+", runsCompleted: 4, ageKnown: true, expands: true },
  UNSURE_CHIP,
];

/** Lowest count `4+` can mean — picking it never *reduces* an existing answer. */
export const TIRE_COUNT_EXPAND_FLOOR = 4;

/** How far the row counts once expanded, unless the current value is higher. */
export const TIRE_COUNT_EXPANDED_MAX = 16;

/**
 * The row after `4+`. Extends past `TIRE_COUNT_EXPANDED_MAX` when the value on
 * the car is higher, so the driver's own answer always has a chip to sit on —
 * a two-day club set can be well past 16.
 */
export function expandedTireCountChips(currentRunsCompleted: number): readonly TireCountChip[] {
  const top = Math.max(TIRE_COUNT_EXPANDED_MAX, currentRunsCompleted);
  const out: TireCountChip[] = [NEW_CHIP];
  for (let n = 1; n <= top; n += 1) {
    out.push({ key: String(n), label: String(n), runsCompleted: n, ageKnown: true });
  }
  out.push(UNSURE_CHIP);
  return out;
}

/**
 * Which chip the current value reads as, or null when no compound is picked and
 * there is nothing to show yet. Collapsed, anything past 3 sits under `4+`;
 * expanded, it lights its own number.
 */
export function activeTireCountChip(
  source: TireAgeSource,
  value: TireStintValue,
  expanded = false
): string | null {
  if (source === null) return null;
  if (!value.ageKnown) return "unsure";
  if (value.runsCompleted === 0) return "new";
  if (!expanded && value.runsCompleted >= TIRE_COUNT_EXPAND_FLOOR) return "more";
  return String(value.runsCompleted);
}
