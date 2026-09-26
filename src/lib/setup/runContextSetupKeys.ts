import { filledSetupValueCount, normalizeSetupData } from "@/lib/runSetup";
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

/**
 * How many boxes of a setup say something about the CAR, counted as they would be stored.
 *
 * The run form writes today's tyre into the run's setup by itself, so a plain count read a run
 * with no setup at all as "Setup 1 values · as last run", ticked the Setup step and let the run
 * be completed as if a setup were attached (test drive 2026-09-26). The keys above are left out.
 * The rest goes through the storage normaliser first, so a cleared box's `""` marker counts as
 * nothing and a `_other` companion folds into its row instead of counting twice.
 *
 * `unknown` because it also reads setups as they come back from the server.
 */
export function chassisValueCount(setup: unknown): number {
  const stored = normalizeSetupData(setup);
  for (const key of Object.keys(stored)) {
    if (isRunContextSetupKey(key)) delete stored[key];
  }
  return filledSetupValueCount(stored);
}

/**
 * `chassisValueCount(setup) > 0`, cheaply: it stops at the first box with a value. For whole lists
 * of setups (every run on a car), where normalising each one in full would cost a render.
 */
export function setupHasChassisValue(setup: unknown): boolean {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) return false;
  return Object.entries(setup as Record<string, unknown>).some(
    ([key, value]) => !isRunContextSetupKey(key) && holdsAValue(value)
  );
}

/** Recursive: grouped rows arrive as arrays and preset rows as objects. `0` and `false` count. */
function holdsAValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(holdsAValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(holdsAValue);
  return true;
}
