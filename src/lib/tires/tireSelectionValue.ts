/**
 * The `tires` value stored inside a setup snapshot. Tires are identified by the
 * compound plus how many runs are on them — there is no named set, no mark, and
 * no insert/wheel (those had no writer in any UI and were overwritten on every
 * save by `applyRunContextToSetupSnapshot`).
 */
export type TireSelectionValue = {
  tireTypeId: string;
  /** Runs on this rubber as of this run; 1 = first run on it. */
  tireRunNumber?: number;
  /** False when the driver said "not sure how many" — the count is relative. */
  tireAgeKnown?: boolean;
  /** Denormalized for PDF/export; derived from TireType.displayName */
  displayName?: string;
};

const TIRE_FIELD_KEYS = new Set(["tires", "tires_setup"]);

export function isTireSelectionValue(v: unknown): v is TireSelectionValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.tireTypeId === "string" && rec.tireTypeId.trim().length > 0;
}

function coerceRunNumber(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  return n >= 1 ? n : undefined;
}

export function normalizeTireSelectionFromUnknown(
  v: unknown,
  fallbackDisplayName?: string
): TireSelectionValue | null {
  if (isTireSelectionValue(v)) {
    const tireTypeId = v.tireTypeId.trim();
    if (!tireTypeId) return null;
    const displayName =
      typeof v.displayName === "string" && v.displayName.trim()
        ? v.displayName.trim()
        : fallbackDisplayName?.trim() || undefined;
    return {
      tireTypeId,
      tireRunNumber: coerceRunNumber((v as TireSelectionValue).tireRunNumber),
      // Legacy snapshots predate the flag; absent means the count is absolute.
      tireAgeKnown:
        typeof (v as TireSelectionValue).tireAgeKnown === "boolean"
          ? (v as TireSelectionValue).tireAgeKnown
          : undefined,
      displayName,
    };
  }
  return null;
}

export function displayTireSelection(value: TireSelectionValue | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  const parts: string[] = [value.displayName?.trim() || "Tire"];
  if (value.tireAgeKnown === false) {
    parts.push(
      value.tireRunNumber != null && value.tireRunNumber > 0
        ? `run ${value.tireRunNumber} · age unknown`
        : "age unknown"
    );
  } else if (value.tireRunNumber != null && value.tireRunNumber > 0) {
    parts.push(`run ${value.tireRunNumber}`);
  }
  return parts.join(" · ");
}

export function buildTireSelectionValue(input: {
  tireTypeId: string;
  displayName: string;
  tireRunNumber?: number | null;
  tireAgeKnown?: boolean | null;
}): TireSelectionValue {
  return {
    tireTypeId: input.tireTypeId,
    displayName: input.displayName.trim(),
    tireRunNumber: coerceRunNumber(input.tireRunNumber),
    tireAgeKnown: input.tireAgeKnown === false ? false : undefined,
  };
}

export function isTireFieldKey(key: string): boolean {
  return TIRE_FIELD_KEYS.has(key);
}
