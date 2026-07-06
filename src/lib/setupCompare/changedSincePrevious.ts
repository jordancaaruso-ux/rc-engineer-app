import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { compareSetupField } from "@/lib/setupCompare/compare";

export type SetupChangedRow = {
  label: string;
  value: string;
  previousValue: string;
};

export function setupFieldLabel(key: string): string {
  const f = DEFAULT_SETUP_FIELDS.find((d) => d.key === key);
  return f ? f.label + (f.unit ? ` (${f.unit})` : "") : key.replace(/_/g, " ");
}

/** Fields that differ between a run's setup and the previous run on the same car (compare semantics). */
export function setupChangedRowsSincePrevious(
  current: unknown,
  previous: unknown
): SetupChangedRow[] {
  const cur = normalizeSetupData(current);
  const prev = normalizeSetupData(previous);
  const keys = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const rows: SetupChangedRow[] = [];
  for (const key of [...keys].sort()) {
    const cmp = compareSetupField({
      key,
      a: cur[key],
      b: prev[key],
      numericAggregationByKey: null,
    });
    if (cmp.areEqual) continue;
    rows.push({
      label: setupFieldLabel(key),
      value: cmp.normalizedA,
      previousValue: cmp.normalizedB,
    });
  }
  return rows;
}
