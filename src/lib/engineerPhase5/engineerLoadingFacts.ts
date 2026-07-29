/**
 * Decorative "while you wait" filler for the Engineer chat loading state.
 *
 * NOT KNOWLEDGE BASE. These strings are hand-written, generic RC trivia. They are never
 * retrieved, never put in a model prompt, never cited, and never presented as an answer or
 * as a claim about what the server is doing. The real KB (`content/vehicle-dynamics/*.md`,
 * `parameterEffects/catalog.ts`) is ground truth quoted to drivers — do not copy from it
 * into this file, and do not derive these lines from it.
 *
 * Keep each line non-prescriptive (an observation, never a setup instruction, so it can't be
 * misread as Engineer advice) and under ~110 chars so it fits two lines at 390px.
 */
export const ENGINEER_LOADING_FACTS: readonly string[] = [
  "Tire choice usually moves lap time more than any single setup change.",
  "Track temperature can shift grip more between morning and afternoon than a day of setup work.",
  "Ride height is measured with the car at its normal running weight, not held in the air.",
  "Gear ratio affects motor temperature as much as it affects acceleration.",
  "A fresh set of tires can flatter a bad setup for the first few laps.",
  "Consistency across a run wins more races than a single fast lap.",
  "Pack voltage sags as a run goes on, so late-run pace isn't the same test as early-run pace.",
  "Two identical-looking runs on different days can sit on very different surfaces.",
  "Changing one thing at a time is slower in the pits and faster on the clock.",
  "Drivers adapt to a car within a few laps, which is why back-to-back testing beats memory.",
  "Most RC timing systems log to the thousandth of a second — small deltas are still real data.",
  "Off-road and on-road setups drift apart fastest at the shocks, not the geometry.",
];

/** No fact until the current real status has been on screen this long. */
export const ENGINEER_FACT_IDLE_MS = 6_000;
/** Once showing, swap facts on this cadence. */
export const ENGINEER_FACT_ROTATE_MS = 9_000;

/** Which rotation slot is due, or null if the idle window hasn't elapsed. */
export function engineerLoadingFactSlot(msSinceStatusChange: number): number | null {
  if (!Number.isFinite(msSinceStatusChange) || msSinceStatusChange < ENGINEER_FACT_IDLE_MS) {
    return null;
  }
  return Math.floor((msSinceStatusChange - ENGINEER_FACT_IDLE_MS) / ENGINEER_FACT_ROTATE_MS);
}

/**
 * Fully derived fact selection — no component state beyond the three inputs.
 * `seed` randomises the first fact per turn; `statusChanges` strides by 5 (coprime with the
 * list length) so a new real status never lands back on the fact you just read.
 */
export function engineerLoadingFactAt(
  seed: number,
  statusChanges: number,
  slot: number,
  facts: readonly string[] = ENGINEER_LOADING_FACTS
): string {
  const n = facts.length;
  const i = (((seed + statusChanges * 5 + slot) % n) + n) % n;
  return facts[i]!;
}
