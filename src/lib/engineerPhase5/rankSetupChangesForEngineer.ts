import { normalizeSetupData } from "@/lib/runSetup";
import { listSetupKeysChangedBetweenSnapshots } from "@/lib/setupCompare/listSetupKeysChangedBetweenSnapshots";
import { compareSetupField } from "@/lib/setupCompare/compare";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";
import { DEFAULT_SETUP_FIELDS } from "@/lib/runSetup";
import type { EngineerSetupChangeRow } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

const MAX_CHANGES = 8;

const fieldMap = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f]));
const a800rrMap = buildFieldMetaMap(buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1));

function labelForKey(key: string): string {
  const d = fieldMap.get(key);
  if (d) return d.label + (d.unit ? ` (${d.unit})` : "");
  const m = a800rrMap.get(key);
  if (m) return m.label + (m.unit ? ` (${m.unit})` : "");
  return key.replace(/_/g, " ");
}

function severityRank(sev: string): number {
  if (sev === "major") return 4;
  if (sev === "moderate") return 3;
  if (sev === "minor") return 2;
  if (sev === "same") return 0;
  return 1;
}

function rankReasonFromCompare(key: string, sev: string, gradientIntensity?: number): string {
  if (gradientIntensity != null && Number.isFinite(gradientIntensity)) {
    return `compare intensity ${(gradientIntensity * 100).toFixed(0)}% (${sev})`;
  }
  if (sev === "major" || sev === "moderate" || sev === "minor") return `field diff ${sev}`;
  return `changed (${sev})`;
}

/**
 * Top-N setup rows vs reference, ranked by compareSetupField severity (reuse comparison system).
 */
export function rankSetupChangesForEngineer(
  currentData: unknown,
  referenceData: unknown,
  numericAggregationByKey: ReadonlyMap<string, NumericAggregationCompareSlice> | null
): EngineerSetupChangeRow[] {
  const keys = listSetupKeysChangedBetweenSnapshots(currentData, referenceData);
  const cur = normalizeSetupData(currentData);
  const prev = normalizeSetupData(referenceData);

  const rows: EngineerSetupChangeRow[] = [];
  for (const key of keys) {
    const cmp = compareSetupField({
      key,
      a: cur[key],
      b: prev[key],
      numericAggregationByKey,
    });
    if (cmp.areEqual) continue;
    rows.push({
      key,
      label: labelForKey(key),
      before: cmp.normalizedB,
      after: cmp.normalizedA,
      rankReason: rankReasonFromCompare(key, cmp.severity, cmp.gradientIntensity),
      severity: cmp.severity,
    });
  }

  rows.sort((a, b) => {
    const dr = severityRank(b.severity) - severityRank(a.severity);
    if (dr !== 0) return dr;
    return a.label.localeCompare(b.label);
  });

  return rows.slice(0, MAX_CHANGES);
}
