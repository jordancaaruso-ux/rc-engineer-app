import {
  getLiveRcDriverNameSetting,
  getSpeedhiveTransponderLoanerSetting,
} from "@/lib/appSettings";
import { getSpeedhiveTransponderNumbersForUser } from "@/lib/speedhive/speedhiveDriverSettings";

/**
 * Timing identity — the one thing that lets lap times attach to a driver on
 * their own (docs/ONBOARDING_NORTH_STAR.md). Hand-typing laps is what this app
 * exists to remove, so this predicate is what the lap-ingest gate enforces
 * just-in-time, and what the dashboard "Get set up" card reads for its Timing row.
 *
 * Deliberately stricter than `hasSpeedhiveIdentityForUser` (name OR number,
 * Speedhive-only): matching needs the printed NAME *and* either a transponder
 * number or the club/loaner declaration. Lived in `onboarding/progress.ts` until
 * the 4-step guide was retired (2026-07-23); moved here so both consumers survive
 * that deletion.
 */

export type TimingIdentityInput = {
  /** Name as the timing site prints it (`liveRcDriverName`). */
  timingName: string | null;
  /** How many MYLAPS transponder numbers they've saved. */
  transponderCount: number;
  /** They race a club / loaner chip, so there's no number to give. */
  transponderLoaner: boolean;
};

/** Enough for lap times to find them: the printed name, plus a chip or a reason there isn't one. */
export function hasTimingIdentity(input: TimingIdentityInput): boolean {
  return (
    Boolean(input.timingName?.trim()) && (input.transponderCount > 0 || input.transponderLoaner)
  );
}

/** Server reader — loads the three inputs and applies the predicate. Shared by the
 *  setup card (via `loadOnboardingView`) and the lap-ingest gate. */
export async function getTimingIdentityForUser(userId: string): Promise<boolean> {
  const [timingName, transponders, transponderLoaner] = await Promise.all([
    getLiveRcDriverNameSetting(userId),
    getSpeedhiveTransponderNumbersForUser(userId),
    getSpeedhiveTransponderLoanerSetting(userId),
  ]);
  return hasTimingIdentity({
    timingName,
    transponderCount: transponders.length,
    transponderLoaner,
  });
}
