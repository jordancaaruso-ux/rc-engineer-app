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
