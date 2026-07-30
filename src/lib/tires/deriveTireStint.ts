/**
 * The rules that let picking a compound decide the tire age too.
 *
 * Kept out of the React panel because this is where the judgement lives — most
 * of all the stint fork rule, which the Engineer's wear chains
 * (`engineerPhase5/tireLifePriors`) group on. Getting it wrong either welds two
 * unrelated sets into one life of rubber, or breaks a real one in half.
 */

import {
  TIRE_COUNT_EXPAND_FLOOR,
  type TireCountChip,
} from "@/lib/tires/tireAgeReadout";
import type { LastRunTires, TireAgeSource, TireStintValue } from "@/lib/tires/tireStintValue";

const FRESH: TireStintValue = { runsCompleted: 0, ageKnown: true, stintId: null };

/**
 * What's on the car, worked out from the compound alone.
 *
 * Same compound as the last run means the same rubber went back on, so its stint
 * comes forward and this log becomes run N+1. Anything else — another compound,
 * or a car with no history — is a fresh set on run 1. An unknown age carries as
 * unknown rather than being replaced with an invented number.
 */
export function deriveTireStintForCompound(
  last: LastRunTires | null,
  tireTypeId: string
): { value: TireStintValue; source: TireAgeSource } {
  if (!tireTypeId) return { value: { ...FRESH }, source: null };
  if (last && last.tireTypeId === tireTypeId) {
    return {
      value: {
        runsCompleted: last.tireRunNumber,
        ageKnown: last.tireAgeKnown,
        stintId: last.tireStintId,
      },
      source: "carried",
    };
  }
  return { value: { ...FRESH }, source: "assumedFresh" };
}

/**
 * A chip tap, which is always a correction of the guess above.
 *
 * The stint survives only when the tap lands back on the carried value — that is
 * the driver confirming the guess, not changing it. Every other count means
 * different rubber is on the car, so the stint is dropped and the server mints a
 * fresh one on save. Refining an unknown age into a number counts as different
 * rubber too: there is no way to tell "I finally counted them" from "I fitted a
 * used set", and welding two sets together is the more expensive mistake.
 */
export function applyTireCountChip(
  chip: TireCountChip,
  current: TireStintValue,
  last: LastRunTires | null,
  source: TireAgeSource
): { value: TireStintValue; source: TireAgeSource; expand: boolean } {
  // `4+` keeps whatever the driver already had if that was higher — picking it
  // must never walk an answer of 9 back down to 4.
  const runsCompleted = chip.expands
    ? Math.max(TIRE_COUNT_EXPAND_FLOOR, current.runsCompleted)
    : chip.runsCompleted;
  const ageKnown = chip.ageKnown;

  const confirmsCarried =
    source === "carried" &&
    last != null &&
    ageKnown === last.tireAgeKnown &&
    runsCompleted === last.tireRunNumber;

  return {
    value: {
      runsCompleted,
      ageKnown,
      stintId: confirmsCarried ? (last as LastRunTires).tireStintId : null,
    },
    source: confirmsCarried ? "carried" : "manual",
    expand: chip.expands === true,
  };
}

/**
 * True when a value handed in from outside has nothing worth keeping — the test
 * for whether auto-derivation is allowed to write over it. A run that has been
 * saved, replicated, or prefilled always arrives with a server-minted stint, so
 * only a genuinely untouched form passes.
 */
export function isTireStintUnanswered(value: TireStintValue): boolean {
  return value.stintId == null && value.runsCompleted === 0 && value.ageKnown;
}
