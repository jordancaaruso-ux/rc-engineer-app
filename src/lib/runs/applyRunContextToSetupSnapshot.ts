import type { SetupSnapshotData } from "@/lib/runSetup";
import { tireSelectionFromTireSet } from "@/lib/tires/tireSelectionFromSet";
import { allTirePrepBooleanKeys } from "@/lib/tires/tirePrepFields";
import { getBoolFromSetupString } from "@/lib/a800rrSetupRead";

type TireSetForSnapshot = Parameters<typeof tireSelectionFromTireSet>[0];

export type RunContextSnapshotInput = {
  resolvedData: SetupSnapshotData;
  sheetKeys: Set<string>;
  tireSet: TireSetForSnapshot | null;
  batteryLabel: string;
  additiveDisplayName: string | null;
  warmerTimingMinutes: number | null;
};

/** Merge run-context tire, battery, additive, and prep booleans into a setup snapshot. Skips keys absent from the sheet. */
export function applyRunContextToSetupSnapshot(input: RunContextSnapshotInput): SetupSnapshotData {
  const next: SetupSnapshotData = { ...input.resolvedData };

  const tireValue = input.tireSet ? tireSelectionFromTireSet(input.tireSet) : undefined;
  if (tireValue) {
    next.tires = tireValue;
  } else if ("tires" in next) {
    delete next.tires;
  }

  if (input.batteryLabel) {
    next.battery = input.batteryLabel;
  } else if ("battery" in next) {
    delete next.battery;
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
