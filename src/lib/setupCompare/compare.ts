import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  displayPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
  presetWithOtherEquals,
} from "@/lib/setup/presetWithOther";
import { normalizeMotorMountScrews, normalizeTopDeckCuts, normalizeTopDeckScrews } from "@/lib/setup/screwNormalize";
import { buildCatalogFromTemplate, buildFieldMetaMap } from "@/lib/setupFieldCatalog";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { FieldCompareResult, FieldKind, FieldMeta, CompareSeverity } from "@/lib/setupCompare/types";
import { normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import {
  getNumericGradientConfig,
  normalizeNumericForGradientCompare,
  numericGradientEqual,
} from "@/lib/setupCompare/numericGradientConfig";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import { gradientIntensityFromIqrDelta } from "@/lib/setupCompare/numericAggregationCompare";

const SCREW_KEYS = new Set(["motor_mount_screws", "top_deck_screws", "top_deck_cuts"]);

function isNil(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function normalizeMulti(key: string, v: unknown): string[] {
  if (key === "motor_mount_screws") return normalizeMotorMountScrews(v) ?? [];
  if (key === "top_deck_cuts") return normalizeTopDeckCuts(v) ?? [];
  if (key === "top_deck_screws") return normalizeTopDeckScrews(v) ?? [];
  return normalizeMultiSelectValue(key, v);
}

function normalizeNumberish(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return parseNumericFromSetupString(v, { allowKSuffix: false });
}

function formatNormalized(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("selectedPreset" in o || "otherText" in o) {
      const pov = normalizePresetWithOtherFromUnknown(o, undefined, null);
      return displayPresetWithOther(pov).trim() || "—";
    }
  }
  return String(v).trim();
}

function inferKind(key: string, a: unknown, b: unknown): FieldKind {
  const taxonomyKind = getCalibrationFieldKind(key);
  if (taxonomyKind === "visualMulti") return "multiSelect";
  if (taxonomyKind === "boolean") return "boolean";
  if (taxonomyKind === "number") return "number";
  if (SCREW_KEYS.has(key)) return "multiSelect";
  if (Array.isArray(a) || Array.isArray(b)) return "multiSelect";
  // boolean-ish: only treat as boolean if at least one side matches boolean tokens
  const aS = typeof a === "string" ? a.trim().toLowerCase() : "";
  const bS = typeof b === "string" ? b.trim().toLowerCase() : "";
  const boolToken = (s: string) => ["1", "0", "true", "false", "yes", "no", "on", "off", ""].includes(s);
  if (boolToken(aS) && boolToken(bS) && (aS !== "" || bS !== "")) return "boolean";
  const an = normalizeNumberish(a);
  const bn = normalizeNumberish(b);
  if (an != null && bn != null) return "number";
  // categorical: treat case-insensitive if short tokens
  return "categorical";
}

/** Map 0–1 intensity to summary severity (cell color is continuous via gradientIntensity). */
function severityFromGradientIntensity(intensity01: number): CompareSeverity {
  if (intensity01 <= 0) return "same";
  if (intensity01 < 0.26) return "minor";
  if (intensity01 < 0.58) return "moderate";
  return "major";
}

function severityForNumeric(deltaAbs: number, baseAbs: number, thresholds?: { minor?: number; moderate?: number }): {
  severity: CompareSeverity;
  reason: string;
} {
  const minor = thresholds?.minor ?? 0.1;
  const moderate = thresholds?.moderate ?? 0.5;
  const rel = baseAbs > 0 ? deltaAbs / baseAbs : deltaAbs;
  if (deltaAbs === 0) return { severity: "same", reason: "equal" };
  if (deltaAbs <= minor || rel <= 0.02) return { severity: "minor", reason: `Δ=${deltaAbs} (minor)` };
  if (deltaAbs <= moderate || rel <= 0.06) return { severity: "moderate", reason: `Δ=${deltaAbs} (moderate)` };
  return { severity: "major", reason: `Δ=${deltaAbs} (major)` };
}

function buildDefaultMetaMap(): Map<string, FieldMeta> {
  const catalog = buildCatalogFromTemplate(A800RR_SETUP_SHEET_V1);
  const map = buildFieldMetaMap(catalog);
  const out = new Map<string, FieldMeta>();
  for (const [k, v] of map.entries()) {
    out.set(k, { key: k, label: v.label, kind: "text" });
  }
  // Known multi-select visual fields
  out.set("motor_mount_screws", { key: "motor_mount_screws", label: "Motor mount screws", kind: "multiSelect" });
  out.set("top_deck_screws", { key: "top_deck_screws", label: "Top deck screws", kind: "multiSelect" });
  out.set("top_deck_cuts", { key: "top_deck_cuts", label: "Top deck cuts", kind: "multiSelect" });
  out.set("track_layout", { key: "track_layout", label: "Track layout", kind: "multiSelect" });
  out.set("traction", { key: "traction", label: "Traction", kind: "multiSelect" });
  out.set("front_spring_rate_gf_mm", { key: "front_spring_rate_gf_mm", label: "Front spring rate (gf/mm)", kind: "number" });
  out.set("rear_spring_rate_gf_mm", { key: "rear_spring_rate_gf_mm", label: "Rear spring rate (gf/mm)", kind: "number" });
  out.set("final_drive_ratio", { key: "final_drive_ratio", label: "Final drive ratio", kind: "number" });
  out.set("tires", { key: "tires", label: "Tires", kind: "text" });
  return out;
}

const DEFAULT_META = buildDefaultMetaMap();

export function compareSetupField(input: {
  key: string;
  a: unknown;
  b: unknown;
  meta?: FieldMeta;
  /** Car numeric aggregations: scale only (IQR), not rarity. */
  numericAggregationByKey?: ReadonlyMap<string, NumericAggregationCompareSlice> | null;
}): FieldCompareResult {
  const key = input.key;
  const meta = input.meta ?? DEFAULT_META.get(key) ?? { key, label: key, kind: "text" as const };
  const kind = meta.kind === "text" ? inferKind(key, input.a, input.b) : meta.kind;

  // nil equality
  if (isNil(input.a) && isNil(input.b)) {
    return {
      key,
      areEqual: true,
      severity: "same",
      severityReason: "both blank",
      normalizedA: "—",
      normalizedB: "—",
    };
  }

  if (isPresetWithOtherFieldKey(key)) {
    const opts = getSingleSelectChipOptions(key);
    const aa = normalizePresetWithOtherFromUnknown(input.a, undefined, opts);
    const bb = normalizePresetWithOtherFromUnknown(input.b, undefined, opts);
    const same = presetWithOtherEquals(aa, bb);
    const na = displayPresetWithOther(aa);
    const nb = displayPresetWithOther(bb);
    return {
      key,
      areEqual: same,
      severity: same ? "same" : "minor",
      severityReason: same ? "equal" : "value differs",
      normalizedA: na.trim() ? na : "—",
      normalizedB: nb.trim() ? nb : "—",
    };
  }

  if (kind === "multiSelect") {
    const aa = normalizeMulti(key, input.a);
    const bb = normalizeMulti(key, input.b);
    const aSet = new Set(aa.map((v) => v.toLowerCase()));
    const bSet = new Set(bb.map((v) => v.toLowerCase()));
    const same = aSet.size === bSet.size && [...aSet].every((x) => bSet.has(x));
    const inter = aa.filter((x) => bSet.has(x)).length;
    const union = new Set([...aa, ...bb]).size;
    const overlap = union === 0 ? 1 : inter / union;
    const severity: CompareSeverity = same ? "same" : overlap >= 0.67 ? "minor" : overlap >= 0.34 ? "moderate" : "major";
    return {
      key,
      areEqual: same,
      severity,
      severityReason: same ? "same selection" : `overlap ${(overlap * 100).toFixed(0)}%`,
      normalizedA: aa.length ? aa.join(", ") : "—",
      normalizedB: bb.length ? bb.join(", ") : "—",
    };
  }

  if (kind === "boolean") {
    const aOn = getBoolFromSetupString(String(input.a ?? ""));
    const bOn = getBoolFromSetupString(String(input.b ?? ""));
    const same = aOn === bOn;
    return {
      key,
      areEqual: same,
      severity: same ? "same" : "moderate",
      severityReason: same ? "same" : "toggle differs",
      normalizedA: aOn ? "Yes" : "No",
      normalizedB: bOn ? "Yes" : "No",
    };
  }

  const gradCfg = getNumericGradientConfig(key);
  if (gradCfg) {
    const nilA = isNil(input.a);
    const nilB = isNil(input.b);
    if (nilA && nilB) {
      return {
        key,
        areEqual: true,
        severity: "same",
        severityReason: "both blank",
        normalizedA: "—",
        normalizedB: "—",
      };
    }
    const na = normalizeNumericForGradientCompare(key, gradCfg.normalization, input.a);
    const nb = normalizeNumericForGradientCompare(key, gradCfg.normalization, input.b);
    if (na != null && nb != null) {
      if (numericGradientEqual(na, nb, gradCfg)) {
        return {
          key,
          areEqual: true,
          severity: "same",
          severityReason: "equal within tolerance",
          normalizedA: String(na),
          normalizedB: String(nb),
        };
      }
      const delta = Math.abs(na - nb);
      const agg = input.numericAggregationByKey?.get(key) ?? null;
      const gradientIntensity = gradientIntensityFromIqrDelta(delta, agg, key);
      if (gradientIntensity != null) {
        const severity = severityFromGradientIntensity(gradientIntensity);
        return {
          key,
          areEqual: false,
          severity,
          severityReason: `Δ=${delta} (IQR-scaled)`,
          normalizedA: String(na),
          normalizedB: String(nb),
          gradientIntensity,
        };
      }
      return {
        key,
        areEqual: false,
        severity: "unknown",
        severityReason: "different (no robust aggregation scale)",
        normalizedA: String(na),
        normalizedB: String(nb),
      };
    }
    const sa = formatNormalized(input.a);
    const sb = formatNormalized(input.b);
    const same = sa === sb;
    return {
      key,
      areEqual: same,
      severity: same ? "same" : "unknown",
      severityReason: same ? "equal" : "missing or unparsable numeric",
      normalizedA: sa,
      normalizedB: sb,
    };
  }

  if (kind === "number") {
    const an = normalizeNumberish(input.a);
    const bn = normalizeNumberish(input.b);
    if (an == null || bn == null) {
      const sa = formatNormalized(input.a);
      const sb = formatNormalized(input.b);
      const same = sa === sb;
      return {
        key,
        areEqual: same,
        severity: same ? "same" : "unknown",
        severityReason: same ? "equal" : "non-numeric format",
        normalizedA: sa,
        normalizedB: sb,
      };
    }
    const delta = Math.abs(an - bn);
    const baseAbs = Math.max(Math.abs(an), Math.abs(bn));
    const sev = severityForNumeric(delta, baseAbs, meta.thresholds);
    return {
      key,
      areEqual: delta === 0,
      severity: delta === 0 ? "same" : sev.severity,
      severityReason: sev.reason,
      normalizedA: String(an),
      normalizedB: String(bn),
    };
  }

  // categorical/text
  const sa = formatNormalized(input.a);
  const sb = formatNormalized(input.b);
  const aNorm = sa === "—" ? "" : sa.trim();
  const bNorm = sb === "—" ? "" : sb.trim();
  const aLower = aNorm.toLowerCase();
  const bLower = bNorm.toLowerCase();
  const same = aLower === bLower;
  return {
    key,
    areEqual: same,
    severity: same ? "same" : "minor",
    severityReason: same ? "equal" : "value differs",
    normalizedA: sa,
    normalizedB: sb,
  };
}

export function compareSetupSnapshots(
  a: SetupSnapshotData,
  b: SetupSnapshotData,
  options?: { numericAggregationByKey?: ReadonlyMap<string, NumericAggregationCompareSlice> | null }
): Map<string, FieldCompareResult> {
  const keys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter(
      (k) => !k.startsWith("imported_displayed_spring_rate_") && k !== "imported_displayed_final_drive_ratio"
    )
  );
  const out = new Map<string, FieldCompareResult>();
  const numericAggregationByKey = options?.numericAggregationByKey ?? null;
  for (const k of keys) {
    out.set(k, compareSetupField({ key: k, a: a[k], b: b[k], numericAggregationByKey }));
  }
  return out;
}

export function maxSeverity(severities: CompareSeverity[]): CompareSeverity {
  const rank: Record<CompareSeverity, number> = { same: 0, minor: 1, moderate: 2, major: 3, unknown: 1 };
  let best: CompareSeverity = "same";
  for (const s of severities) {
    if (rank[s] > rank[best]) best = s;
  }
  return best;
}

