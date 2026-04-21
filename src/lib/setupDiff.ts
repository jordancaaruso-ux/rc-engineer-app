import { DEFAULT_SETUP_FIELDS, normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";
import { isMultiSelectFieldKey, multiSelectSetEquals } from "@/lib/setup/multiSelect";

/** Treat 2 / 2.0 / "2 mm" as equal so "changed" matches numeric reality for shims. */
function parseNumericForDiff(s: string): number | null {
  const t = s.trim();
  if (!t || t === "—" || t === "-") return null;
  const cleaned = t.replace(/mm/gi, "").replace(",", ".").trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function scalarValuesEqualForDiff(curStr: string, prevStr: string): boolean {
  if (curStr === prevStr) return true;
  const n1 = parseNumericForDiff(curStr);
  const n2 = parseNumericForDiff(prevStr);
  if (n1 != null && n2 != null) {
    return Math.abs(n1 - n2) < 1e-4;
  }
  return false;
}

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
    const changed =
      previous != null
        ? isMultiSelectFieldKey(key)
          ? !multiSelectSetEquals(key, c, p)
          : !scalarValuesEqualForDiff(curStr, prevStr!)
        : false;
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
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

export { normalizeSetupData };
