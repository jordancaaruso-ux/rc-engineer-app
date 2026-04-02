import type { SetupSnapshotData } from "@/lib/runSetup";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  displayPresetWithOther,
  getPresetWithOtherFromData,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
  presetWithOtherEquals,
  scalarSetupTextFromUnknown,
} from "@/lib/setup/presetWithOther";
import {
  normalizeMotorMountScrews,
  normalizeTopDeckCuts,
  normalizeTopDeckScrews,
} from "@/lib/setup/screwNormalize";
import { isMultiSelectFieldKey, multiSelectSetEquals, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";

/** Canonical key → legacy keys to read if canonical is empty */
export const SETUP_FIELD_READ_ALIASES: Record<string, string[]> = {
  caster_front: ["caster"],
  total_weight: ["weight_total"],
  bodyshell: ["body"],
  damper_oil_front: ["shock_oil_front"],
  damper_oil_rear: ["shock_oil_rear"],
  spring_front: ["spring_front"],
  spring_rear: ["spring_rear"],
  at15_front: ["at15"],
  at15_rear: ["at15"],
  at13w_front: ["at13w"],
  at13w_rear: ["at13w"],
  wheel_spacer_front: ["wheel_spacer"],
  wheel_spacer_rear: ["wheel_spacer"],
  diff_height_front: ["diff_height"],
  diff_height_rear: ["diff_height"],
  imported_displayed_front_spring_rate_gf_mm: ["imported_displayed_spring_rate_front_gf_per_mm", "text91"],
  imported_displayed_rear_spring_rate_gf_mm: ["imported_displayed_spring_rate_rear_gf_per_mm", "text93"],
  imported_displayed_final_drive_ratio: ["ratio"],
};

export function rawField(data: SetupSnapshotData, key: string): string {
  const x = data[key];
  if (x == null || x === "") return "";
  if (isPresetWithOtherFieldKey(key) && x && typeof x === "object" && !Array.isArray(x)) {
    const opts = getSingleSelectChipOptions(key);
    const pov = getPresetWithOtherFromData(data as Record<string, unknown>, key, opts);
    return displayPresetWithOther(pov);
  }
  if (x && typeof x === "object" && !Array.isArray(x) && ("selectedPreset" in x || "otherText" in x)) {
    const opts = getSingleSelectChipOptions(key);
    const pov = normalizePresetWithOtherFromUnknown(x, undefined, opts);
    return displayPresetWithOther(pov);
  }
  if (Array.isArray(x)) return x.join(", ");
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const s = scalarSetupTextFromUnknown(x).trim();
    if (s) return s;
  }
  return String(x).trim();
}

/** Read display value with legacy fallbacks */
export function readSetupField(data: SetupSnapshotData, key: string): string {
  const direct = rawField(data, key);
  if (direct !== "") return direct;
  const aliases = SETUP_FIELD_READ_ALIASES[key];
  if (aliases) {
    for (const a of aliases) {
      const v = rawField(data, a);
      if (v !== "") return v;
    }
  }
  return "";
}

export function readSetupMultiSelection(data: SetupSnapshotData, key: string): string[] {
  const raw = data[key];
  if (raw != null) return normalizeMultiSelectValue(key, raw);
  return normalizeMultiSelectValue(key, readSetupField(data, key));
}

export function valuesEqual(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function readSetupScrewSelection(
  data: SetupSnapshotData,
  key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts"
): string[] {
  try {
    const v = data[key];
    const norm =
      key === "motor_mount_screws"
        ? normalizeMotorMountScrews(v)
        : key === "top_deck_cuts"
          ? normalizeTopDeckCuts(v)
          : normalizeTopDeckScrews(v);
    return norm ?? [];
  } catch {
    return [];
  }
}

/** Preset selection string for chip highlight (not display text). */
export function readPresetWithOtherSelection(data: SetupSnapshotData, key: string): string {
  if (!isPresetWithOtherFieldKey(key)) return "";
  const opts = getSingleSelectChipOptions(key);
  const pov = getPresetWithOtherFromData(data as Record<string, unknown>, key, opts);
  return pov.selectedPreset.trim();
}

/** Single-choice PDF widgets match on preset token, not free-text display. */
export function readSetupSingleChoiceForPdf(data: SetupSnapshotData, key: string): string {
  if (isPresetWithOtherFieldKey(key)) return readPresetWithOtherSelection(data, key);
  return readSetupField(data, key);
}

/** Display string for review/print: otherText when set, else selectedPreset label. */
export function readPresetWithOtherDisplay(data: SetupSnapshotData, key: string): string {
  if (!isPresetWithOtherFieldKey(key)) return readSetupField(data, key);
  const opts = getSingleSelectChipOptions(key);
  const pov = getPresetWithOtherFromData(data as Record<string, unknown>, key, opts);
  return displayPresetWithOther(pov);
}

export function setupValuesDiffer(
  current: SetupSnapshotData,
  baseline: SetupSnapshotData | null,
  key: string
): boolean {
  if (!baseline) return false;
  if (key === "motor_mount_screws" || key === "top_deck_screws" || key === "top_deck_cuts") {
    const a = readSetupScrewSelection(current, key).join(",");
    const b = readSetupScrewSelection(baseline, key).join(",");
    if (a === "" && b === "") return false;
    return a !== b;
  }
  if (isMultiSelectFieldKey(key)) {
    return !multiSelectSetEquals(key, current[key], baseline[key]);
  }
  if (isPresetWithOtherFieldKey(key)) {
    const opts = getSingleSelectChipOptions(key);
    const a = getPresetWithOtherFromData(current as Record<string, unknown>, key, opts);
    const b = getPresetWithOtherFromData(baseline as Record<string, unknown>, key, opts);
    return !presetWithOtherEquals(a, b);
  }
  const ca = readSetupField(current, key);
  const cb = readSetupField(baseline, key);
  if (ca === "" && cb === "") return false;
  return !valuesEqual(ca, cb);
}

export function formatBoolDisplay(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return "Yes";
  return raw === "" ? "—" : "No";
}

export function getBoolFromSetupString(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Comma-separated multi values → display chips / joined */
export function formatMultiDisplay(raw: string | string[]): string {
  if (Array.isArray(raw)) {
    return raw.length ? raw.join(", ") : "—";
  }
  if (!raw.trim()) return "—";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

export function formatMultiChips(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return [...raw];
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Heuristic for which top-deck fields to emphasize (split vs single). */
export function topDeckRenderMode(data: SetupSnapshotData): "split" | "single" | "unknown" {
  const optsSingle = getSingleSelectChipOptions("top_deck_single");
  const singlePov = getPresetWithOtherFromData(data as Record<string, unknown>, "top_deck_single", optsSingle);
  if (singlePov.selectedPreset.trim() || singlePov.otherText.trim()) return "single";

  const optsF = getSingleSelectChipOptions("top_deck_front");
  const optsR = getSingleSelectChipOptions("top_deck_rear");
  const frontPov = getPresetWithOtherFromData(data as Record<string, unknown>, "top_deck_front", optsF);
  const rearPov = getPresetWithOtherFromData(data as Record<string, unknown>, "top_deck_rear", optsR);
  if (
    frontPov.selectedPreset.trim()
    || frontPov.otherText.trim()
    || rearPov.selectedPreset.trim()
    || rearPov.otherText.trim()
  ) {
    return "split";
  }
  return "unknown";
}
