import type { SetupSnapshotData } from "@/lib/runSetup";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { allTirePrepBooleanKeys } from "@/lib/tires/tirePrepFields";
import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";

/** The compound on the car plus how many runs are on it — the whole tire identity. */
export type TireContextForSnapshot = {
  tireTypeId: string;
  displayName: string;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
};

export type RunContextSnapshotInput = {
  resolvedData: SetupSnapshotData;
  sheetKeys: Set<string>;
  tire: TireContextForSnapshot | null;
  additiveDisplayName: string | null;
  warmerTimingMinutes: number | null;
};

/** Merge run-context tire, additive, and prep booleans into a setup snapshot. Skips keys absent from the sheet. */
export function applyRunContextToSetupSnapshot(input: RunContextSnapshotInput): SetupSnapshotData {
  const next: SetupSnapshotData = { ...input.resolvedData };

  const tireValue =
    input.tire && input.tire.tireTypeId.trim()
      ? buildTireSelectionValue(input.tire)
      : undefined;
  if (tireValue) {
    next.tires = tireValue;
  } else if ("tires" in next) {
    delete next.tires;
  }

  if (input.sheetKeys.has("additive")) {
    if (input.additiveDisplayName?.trim()) {
      next.additive = input.additiveDisplayName.trim();
    } else if ("additive" in next) {
      delete next.additive;
    }
  }

  if (input.sheetKeys.has("additive_time")) {
    if (input.warmerTimingMinutes != null && Number.isFinite(input.warmerTimingMinutes)) {
      next.additive_time = String(Math.max(0, Math.floor(input.warmerTimingMinutes)));
    } else if ("additive_time" in next) {
      delete next.additive_time;
    }
  }

  for (const key of allTirePrepBooleanKeys()) {
    if (!input.sheetKeys.has(key)) continue;
    const raw = input.resolvedData[key];
    if (raw == null || String(raw).trim() === "") {
      if (key in next) delete next[key];
      continue;
    }
    next[key] = getBoolFromSetupString(String(raw)) ? "1" : "";
  }

  return next;
}

export function parseWarmerTimingMinutes(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n >= 0 ? n : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Math.floor(Number(trimmed));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}
