import { parseManualLapText } from "@/lib/lapSession/parseManual";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  displayPresetWithOther,
  getPresetWithOtherFromData,
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  legacyOtherKeyForPresetField,
  normalizePresetWithOtherFromUnknown,
  scalarSetupTextFromUnknown,
  PRESET_WITH_OTHER_BASE_KEYS,
  type PresetWithOtherValue,
} from "@/lib/setup/presetWithOther";
import { canonicalGeometrySignedValue } from "@/lib/setup/geometrySignNormalize";
import { normalizeMotorMountScrews, normalizeTopDeckCuts, normalizeTopDeckScrews } from "@/lib/setup/screwNormalize";
import { isMultiSelectFieldKey, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";

export type { PresetWithOtherValue };

export type SetupSnapshotValue =
  | string
  | number
  | string[]
  | PresetWithOtherValue
  | null
  | undefined;

/** Structured setup key → value. Screw fields use string[]; most keys remain string | number. */
export type SetupSnapshotData = Record<string, SetupSnapshotValue>;

const SCREW_KEYS = new Set(["motor_mount_screws", "top_deck_screws", "top_deck_cuts"]);

export const DEFAULT_SETUP_FIELDS: Array<{
  key: string;
  label: string;
  unit?: string;
}> = [
  { key: "camber_front", label: "Camber (Front)", unit: "°" },
  { key: "camber_rear", label: "Camber (Rear)", unit: "°" },
  { key: "toe_front", label: "Toe (Front)", unit: "°" },
  { key: "toe_rear", label: "Toe (Rear)", unit: "°" },
  { key: "ride_height_front", label: "Ride Height (Front)", unit: "mm" },
  { key: "ride_height_rear", label: "Ride Height (Rear)", unit: "mm" },
  { key: "roll_center_front", label: "Roll Center (Front)", unit: "" },
  { key: "roll_center_rear", label: "Roll Center (Rear)", unit: "" },
  { key: "shock_oil_front", label: "Shock Oil (Front)", unit: "wt" },
  { key: "shock_oil_rear", label: "Shock Oil (Rear)", unit: "wt" },
  { key: "spring_front", label: "Spring (Front)", unit: "" },
  { key: "spring_rear", label: "Spring (Rear)", unit: "" },
  { key: "diff", label: "Diff", unit: "" }
];

export function coerceSetupValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : trimmed;
}

/**
 * Normalizes persisted / imported JSON for app use: legacy comma-separated screw strings → string[],
 * filters invalid screw tokens, dedupes, sorts in sheet order.
 */
export function normalizeSetupSnapshotForStorage(input: unknown): SetupSnapshotData {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};
  const out: SetupSnapshotData = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (k.endsWith("_other") && isPresetWithOtherFieldKey(k.slice(0, -6))) {
      continue;
    }
    if (isPresetWithOtherFieldKey(k)) {
      const opts = getSingleSelectChipOptions(k);
      const merged = getPresetWithOtherFromData(raw, k, opts);
      if (!isEmptyPresetWithOther(merged)) out[k] = merged;
      continue;
    }
    if (SCREW_KEYS.has(k)) {
      const norm =
        k === "motor_mount_screws"
          ? normalizeMotorMountScrews(v)
          : k === "top_deck_cuts"
            ? normalizeTopDeckCuts(v)
            : normalizeTopDeckScrews(v);
      if (norm && norm.length > 0) out[k] = norm;
      continue;
    }
    if (isMultiSelectFieldKey(k)) {
      const normalized = normalizeMultiSelectValue(k, v);
      out[k] = normalized;
      continue;
    }
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      const c = canonicalGeometrySignedValue(k, v);
      out[k] = c !== undefined ? c : v;
      continue;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") continue;
      const c = canonicalGeometrySignedValue(k, t);
      out[k] = c !== undefined ? c : t;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string")) out[k] = v.map((x) => x.trim()).filter(Boolean);
      else out[k] = v.map((x) => String(x)).join(", ");
      continue;
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      if ("selectedPreset" in rec || "otherText" in rec) {
        const opts = getSingleSelectChipOptions(k);
        const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
        if (isPresetWithOtherFieldKey(k)) {
          if (!isEmptyPresetWithOther(pov)) out[k] = pov;
        } else {
          const flat = displayPresetWithOther(pov).trim();
          if (flat) out[k] = flat;
        }
        continue;
      }
      const orphanText = scalarSetupTextFromUnknown(v).trim();
      if (orphanText) out[k] = orphanText;
      continue;
    }
    out[k] = String(v);
  }
  for (const base of PRESET_WITH_OTHER_BASE_KEYS) {
    if (out[base] !== undefined) continue;
    const otherKey = legacyOtherKeyForPresetField(base);
    if (!(otherKey in raw) && !(base in raw)) continue;
    const opts = getSingleSelectChipOptions(base);
    const merged = getPresetWithOtherFromData(raw, base, opts);
    if (!isEmptyPresetWithOther(merged)) out[base] = merged;
  }
  return out;
}

export function normalizeSetupData(data: unknown): SetupSnapshotData {
  return normalizeSetupSnapshotForStorage(data);
}

/**
 * True when a snapshot value should be treated as missing for merge/repair (incoming may replace).
 * Includes legacy corrupt string from `String(object)` and empty preset+other blobs.
 */
export function snapshotValueIsEffectivelyEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" || t === "[object Object]";
  }
  if (typeof v === "number" && Number.isFinite(v)) return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object" && !Array.isArray(v)) {
    const pov = normalizePresetWithOtherFromUnknown(v, undefined, null);
    return isEmptyPresetWithOther(pov);
  }
  return false;
}

/** @deprecated Prefer parseManualLapText; kept for imports that expect this name. */
export function parseLapTimes(text: string): number[] {
  return parseManualLapText(text);
}

