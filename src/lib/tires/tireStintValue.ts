/**
 * The tire-age value the Log Run form carries and saves. Lives in `lib` so the
 * readout copy can be unit-tested without pulling in the React panel.
 */
export type TireStintValue = {
  /** Runs completed on this rubber BEFORE this run. Saved run number is this + 1. */
  runsCompleted: number;
  /** False when the driver said "not sure" — the count is relative, not absolute tire age. */
  ageKnown: boolean;
  /** Null means "different rubber went on" — the server mints a new stint on save. */
  stintId: string | null;
};

/**
 * The tire fields of the car's last logged run — everything needed to work out
 * what's on the car now from nothing but the compound the driver picked.
 * Shaped to match the `Run` columns so callers can hand it straight over.
 */
export type LastRunTires = {
  tireTypeId: string;
  /** Runs on the rubber for THAT run; 1 = it was the first. */
  tireRunNumber: number;
  tireAgeKnown: boolean;
  tireStintId: string | null;
};

/**
 * Where the count on screen came from. Drives the hint line under the chips and
 * nothing else — the saved value is identical whichever way it was reached.
 *
 * - `carried` — the compound matches the last run, so its stint came forward.
 * - `assumedFresh` — a different compound (or no history at all), so run 1.
 * - `manual` — the driver tapped a chip; the guess has been overruled.
 * - `null` — no compound picked yet, so there is nothing to say.
 */
export type TireAgeSource = "carried" | "assumedFresh" | "manual" | null;
