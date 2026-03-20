import { parseManualLapText } from "@/lib/lapSession/parseManual";

export type SetupSnapshotData = Record<string, string | number | null | undefined>;

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

export function normalizeSetupData(data: unknown): SetupSnapshotData {
  if (!data || typeof data !== "object") return {};
  return data as SetupSnapshotData;
}

/** @deprecated Prefer parseManualLapText; kept for imports that expect this name. */
export function parseLapTimes(text: string): number[] {
  return parseManualLapText(text);
}

