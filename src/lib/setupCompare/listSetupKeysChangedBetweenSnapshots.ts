import { normalizeSetupData } from "@/lib/runSetup";
import { compareSetupField } from "@/lib/setupCompare/compare";

export type ListSetupKeysChangedOptions = {
  /** If set, only keys passing this filter are considered (e.g. chassis tuning for Engineer). */
  keyFilter?: (key: string) => boolean;
};

/**
 * Keys whose values differ between two resolved setup snapshots.
 * Matches run history "changed since previous run on same car" semantics (not baseline audit deltas).
 */
export function listSetupKeysChangedBetweenSnapshots(
  current: unknown,
  previous: unknown,
  options?: ListSetupKeysChangedOptions
): string[] {
  const cur = normalizeSetupData(current);
  const prev = normalizeSetupData(previous);
  const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const changed: string[] = [];
  const pass = options?.keyFilter;
  for (const key of [...keys].sort()) {
    if (pass && !pass(key)) continue;
    const cmp = compareSetupField({
      key,
      a: cur[key],
      b: prev[key],
      numericAggregationByKey: null,
    });
    if (!cmp.areEqual) changed.push(key);
  }
  return changed;
}
