/**
 * Immutable merge of baseline setup + per-run changes, then storage normalization.
 * Run logging always persists the full resolved `values` on SetupSnapshot.data;
 * baseSetupSnapshotId + setupDeltaJson are optional audit metadata (never the sole source of truth).
 */

import {
  coerceSetupValue,
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import {
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
} from "@/lib/setup/presetWithOther";
import { normalizeMotorMountScrews, normalizeTopDeckCuts, normalizeTopDeckScrews } from "@/lib/setup/screwNormalize";

function cloneBase(base: SetupSnapshotData): Record<string, unknown> {
  try {
    return structuredClone(base) as Record<string, unknown>;
  } catch {
    return JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  }
}

/**
 * Deep-merge `delta` onto `base` without mutating `base`. Screw keys are normalized;
 * other keys follow coerceSetupValue for strings. Empty string clears scalar to empty string;
 * null removes the key. Final pass runs normalizeSetupSnapshotForStorage.
 */
export function resolveSetupSnapshot(
  base: SetupSnapshotData,
  delta: Record<string, unknown> | null | undefined
): SetupSnapshotData {
  const out = cloneBase(base);
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
    return normalizeSetupSnapshotForStorage(out);
  }

  for (const [k, raw] of Object.entries(delta)) {
    if (raw === undefined) continue;

    if (k === "motor_mount_screws" || k === "top_deck_screws" || k === "top_deck_cuts") {
      const norm =
        k === "motor_mount_screws"
          ? normalizeMotorMountScrews(raw)
          : k === "top_deck_cuts"
            ? normalizeTopDeckCuts(raw)
            : normalizeTopDeckScrews(raw);
      if (norm && norm.length) out[k] = norm;
      else delete out[k];
      continue;
    }

    if (isPresetWithOtherFieldKey(k) && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const opts = getSingleSelectChipOptions(k);
      const o = raw as Record<string, unknown>;
      const next = normalizePresetWithOtherFromUnknown(
        { selectedPreset: o.selectedPreset, otherText: o.otherText },
        undefined,
        opts
      );
      if (isEmptyPresetWithOther(next)) delete out[k];
      else out[k] = next;
      continue;
    }

    if (raw === null) {
      delete out[k];
      continue;
    }

    if (typeof raw === "string") {
      const t = raw.trim();
      if (t === "") out[k] = "";
      else out[k] = coerceSetupValue(t);
      continue;
    }

    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[k] = raw;
      continue;
    }

    if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
      out[k] = raw;
      continue;
    }
  }

  return normalizeSetupSnapshotForStorage(out);
}

function stableJson(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "number") return `n:${v}`;
  if (typeof v === "string") return `s:${v}`;
  return JSON.stringify(v);
}

/** Keys that differ between baseline and resolved (for setupDeltaJson audit trail). */
export function computeSetupDeltaForAudit(
  base: SetupSnapshotData,
  resolved: SetupSnapshotData
): Record<string, unknown> {
  const keys = new Set([...Object.keys(base), ...Object.keys(resolved)]);
  const delta: Record<string, unknown> = {};
  for (const k of keys) {
    if (stableJson(base[k]) !== stableJson(resolved[k])) {
      delta[k] = resolved[k] as unknown;
    }
  }
  return delta;
}
