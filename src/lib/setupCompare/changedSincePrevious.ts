import { DEFAULT_SETUP_FIELDS, normalizeSetupData } from "@/lib/runSetup";
import { compareSetupField } from "@/lib/setupCompare/compare";
import {
  UNIVERSAL_TOURING_PARAMETERS,
  universalParameterIdForSnapshotKey,
} from "@/lib/setupSheetModels/universalParameters";

export type SetupChangedRow = {
  /** Canonical setup-field key (e.g. `camber_front`) — lets callers filter by key. */
  key: string;
  label: string;
  value: string;
  previousValue: string;
};

export function setupFieldLabel(key: string): string {
  const f = DEFAULT_SETUP_FIELDS.find((d) => d.key === key);
  return f ? f.label + (f.unit ? ` (${f.unit})` : "") : key.replace(/_/g, " ");
}

const UNIVERSAL_RANK = new Map(UNIVERSAL_TOURING_PARAMETERS.map((def, index) => [def.id, index]));

/**
 * The order a list of differences is SHOWN in — and so which three lead a capped list.
 *
 * Founder call 2026-09-19: not by the size of the change (a big number on an obscure box is not
 * the headline), but the knobs every car has first — camber, ride height, springs, oil, the link
 * shims — in the registry's own order (alignment, travel, damping, links, drivetrain), then
 * everything particular to this chassis, alphabetically by the name the driver reads.
 *
 * Display only. `setupChangedRowsSincePrevious` keeps its key order for the callers that count or
 * diff rows rather than show them.
 */
export function orderSetupChangedRows(rows: SetupChangedRow[]): SetupChangedRow[] {
  const rank = (row: SetupChangedRow) => {
    const id = universalParameterIdForSnapshotKey(row.key);
    return id == null ? Number.POSITIVE_INFINITY : (UNIVERSAL_RANK.get(id) ?? Number.POSITIVE_INFINITY);
  };
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.label.localeCompare(b.label, "en", { sensitivity: "base", numeric: true });
  });
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
      key,
      label: setupFieldLabel(key),
      value: cmp.normalizedA,
      previousValue: cmp.normalizedB,
    });
  }
  return rows;
}
