import { allTirePrepBooleanKeys } from "@/lib/tires/tirePrepFields";

/**
 * Setup-sheet keys the log-run flow writes on its own — tires, additive, warmer timing and the
 * prep-product booleans. `applyRunContextToSetupSnapshot` mirrors them into the saved sheet so the
 * snapshot stays a complete record, but they are captured on the run's Tires tab, not the chassis
 * sheet. Picking today's tires is not a setup change, so nothing that reports "what changed" may
 * count them: not the run form's "changes since loaded", not the car page's setup history.
 *
 * Founder call 2026-07-22: on the A800RR, 32 of 44 runs differed only by these keys.
 */
export const RUN_CONTEXT_SETUP_KEYS: ReadonlySet<string> = new Set([
  "tires",
  "tires_setup",
  "additive",
  "additive_time",
  ...allTirePrepBooleanKeys(),
]);

export function isRunContextSetupKey(key: string): boolean {
  return RUN_CONTEXT_SETUP_KEYS.has(key);
}

/**
 * Keys of a stored `setupDeltaJson` audit that represent a real change to the car — everything the
 * run form set by itself removed. An empty result means "this run reused the setup it was based on".
 */
export function chassisChangedKeys(delta: unknown): string[] {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return [];
  return Object.keys(delta as Record<string, unknown>).filter((k) => !isRunContextSetupKey(k));
}
