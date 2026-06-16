export type TireSelectionValue = {
  tireTypeId: string;
  /** Optional specific product model for this set. */
  specificModel?: string;
  insert?: string;
  wheel?: string;
  /** Denormalized for PDF/export; derived from TireType.displayName */
  displayName?: string;
};

const TIRE_FIELD_KEYS = new Set(["tires", "tires_setup"]);

export function isTireSelectionValue(v: unknown): v is TireSelectionValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return typeof rec.tireTypeId === "string" && rec.tireTypeId.trim().length > 0;
}

export function normalizeTireSelectionFromUnknown(
  v: unknown,
  fallbackDisplayName?: string
): TireSelectionValue | null {
  if (isTireSelectionValue(v)) {
    const tireTypeId = v.tireTypeId.trim();
    if (!tireTypeId) return null;
    const specificModel =
      typeof v.specificModel === "string" ? v.specificModel.trim() || undefined : undefined;
    const insert = typeof v.insert === "string" ? v.insert.trim() || undefined : undefined;
    const wheel = typeof v.wheel === "string" ? v.wheel.trim() || undefined : undefined;
    const displayName =
      typeof v.displayName === "string" && v.displayName.trim()
        ? v.displayName.trim()
        : fallbackDisplayName?.trim() || undefined;
    return { tireTypeId, specificModel, insert, wheel, displayName };
  }
  return null;
}

export function displayTireSelection(
  value: TireSelectionValue | string | null | undefined,
  setNumber?: number | null
): string {
  if (!value) return "";
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return "";
    if (setNumber != null && setNumber >= 1) return `${t} #${setNumber}`;
    return t;
  }
  const parts: string[] = [];
  const name = value.displayName?.trim() || "Tire";
  parts.push(name);
  if (value.specificModel?.trim()) parts.push(value.specificModel.trim());
  if (value.insert?.trim()) parts.push(`insert: ${value.insert.trim()}`);
  if (value.wheel?.trim()) parts.push(`wheel: ${value.wheel.trim()}`);
  let line = parts.join(" · ");
  if (setNumber != null && setNumber >= 1) line = `${line} #${setNumber}`;
  return line;
}

export function buildTireSelectionValue(input: {
  tireTypeId: string;
  displayName: string;
  specificModel?: string | null;
  insert?: string | null;
  wheel?: string | null;
}): TireSelectionValue {
  return {
    tireTypeId: input.tireTypeId,
    displayName: input.displayName.trim(),
    specificModel: input.specificModel?.trim() || undefined,
    insert: input.insert?.trim() || undefined,
    wheel: input.wheel?.trim() || undefined,
  };
}

export function isTireFieldKey(key: string): boolean {
  return TIRE_FIELD_KEYS.has(key);
}
