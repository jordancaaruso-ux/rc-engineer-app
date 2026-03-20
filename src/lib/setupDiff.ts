import { DEFAULT_SETUP_FIELDS, normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";

/** All keys from both snapshots, with labels where known */
export function buildSetupDiffRows(
  current: SetupSnapshotData,
  previous: SetupSnapshotData | null
): Array<{
  key: string;
  label: string;
  unit: string;
  current: string;
  previous: string | null;
  changed: boolean;
}> {
  const fieldMap = new Map(DEFAULT_SETUP_FIELDS.map((f) => [f.key, f]));

  // Prefer richer, grouped metadata when available (comparison-ready stable keys).
  const a800rrCatalog = buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1);
  const a800rrMap = buildFieldMetaMap(a800rrCatalog);
  const keys = new Set([...Object.keys(current), ...(previous ? Object.keys(previous) : [])]);
  const rows: Array<{
    key: string;
    label: string;
    unit: string;
    current: string;
    previous: string | null;
    changed: boolean;
  }> = [];

  const orderedKeys = [
    ...DEFAULT_SETUP_FIELDS.map((f) => f.key).filter((k) => keys.has(k)),
    // Then any A800RR-known keys in template order (excluding defaults already added)
    ...a800rrCatalog
      .map((f) => f.key)
      .filter((k) => keys.has(k) && !DEFAULT_SETUP_FIELDS.some((f) => f.key === k)),
    // Finally anything else (older experiments / future keys)
    ...[...keys]
      .filter(
        (k) =>
          !DEFAULT_SETUP_FIELDS.some((f) => f.key === k) &&
          !a800rrMap.has(k)
      )
      .sort(),
  ];

  for (const key of orderedKeys) {
    const meta = fieldMap.get(key);
    const meta2 = a800rrMap.get(key);
    const c = current[key];
    const p = previous?.[key];
    const curStr = formatSetupVal(c);
    const prevStr = previous == null ? null : formatSetupVal(p);
    const changed = previous != null && curStr !== prevStr;
    rows.push({
      key,
      label: meta2?.label ?? meta?.label ?? key.replace(/_/g, " "),
      unit: meta2?.unit ?? meta?.unit ?? "",
      current: curStr,
      previous: prevStr,
      changed,
    });
  }
  return rows;
}

function formatSetupVal(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export { normalizeSetupData };
