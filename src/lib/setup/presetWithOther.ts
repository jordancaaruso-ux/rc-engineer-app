/**
 * Preset + optional free-text fields (Awesomatix single-choice with "Other"):
 * canonical snapshot shape is one object per field — not a string plus a separate `*_other` key.
 */

export type PresetWithOtherValue = {
  selectedPreset: string;
  otherText: string;
};

/** Fields that use { selectedPreset, otherText } in SetupSnapshotData (snake_case keys). */
export const PRESET_WITH_OTHER_BASE_KEYS = [
  "chassis",
  "front_bumper",
  "top_deck_front",
  "top_deck_rear",
  "top_deck_single",
] as const;

const PRESET_WITH_OTHER_SET = new Set<string>(PRESET_WITH_OTHER_BASE_KEYS);

export function isPresetWithOtherFieldKey(key: string): boolean {
  return PRESET_WITH_OTHER_SET.has(key);
}

export function legacyOtherKeyForPresetField(baseKey: string): string {
  return `${baseKey}_other`;
}

/** True for keys like `top_deck_front_other` that pair with {@link PRESET_WITH_OTHER_BASE_KEYS}. */
export function isPresetWithOtherCompanionKey(key: string): boolean {
  if (!key.endsWith("_other")) return false;
  return isPresetWithOtherFieldKey(key.slice(0, -6));
}

function normToken(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object") return false;
  if (Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const MAX_SCALAR_TEXT_DEPTH = 6;

/**
 * Turns imported / legacy snapshot fragments into a single display token string.
 * Never uses `String(object)` — that produced `[object Object]` when `otherText` or
 * `selectedPreset` was accidentally stored as a nested object.
 */
export function scalarSetupTextFromUnknown(u: unknown, depth = 0): string {
  if (u == null) return "";
  if (typeof u === "string") return u.trim();
  if (typeof u === "number" && Number.isFinite(u)) return String(u);
  if (typeof u === "boolean") return u ? "true" : "";
  if (depth >= MAX_SCALAR_TEXT_DEPTH) return "";
  if (Array.isArray(u)) {
    const parts = u.map((x) => scalarSetupTextFromUnknown(x, depth + 1)).filter(Boolean);
    return parts.join(", ");
  }
  if (!isPlainObject(u)) return "";
  if ("otherText" in u) {
    const inner = scalarSetupTextFromUnknown(u.otherText, depth + 1);
    if (inner) return inner;
  }
  if ("value" in u) {
    const inner = scalarSetupTextFromUnknown(u.value, depth + 1);
    if (inner) return inner;
  }
  if ("text" in u) {
    const inner = scalarSetupTextFromUnknown(u.text, depth + 1);
    if (inner) return inner;
  }
  if ("selectedPreset" in u) {
    return scalarSetupTextFromUnknown(u.selectedPreset, depth + 1);
  }
  return "";
}

function matchOptionLabel(raw: string, options: readonly string[]): string {
  const t = normToken(raw);
  if (!t) return "";
  /** Legacy PDF/import may store "Other" as the preset token — never treat as a real preset. */
  if (t === "other") return "";
  for (const o of options) {
    if (normToken(o) === "other") continue;
    if (normToken(o) === t) return o;
  }
  return "";
}

/**
 * Normalizes any legacy or partial shape into { selectedPreset, otherText }.
 * `options` should be the Awesomatix chip list for this field (or null → treat as plain text in selectedPreset).
 */
export function normalizePresetWithOtherFromUnknown(
  main: unknown,
  companion: unknown,
  options: readonly string[] | null
): PresetWithOtherValue {
  const companionStr = scalarSetupTextFromUnknown(companion);

  if (isPlainObject(main)) {
    let sp = scalarSetupTextFromUnknown(main.selectedPreset);
    let ot = scalarSetupTextFromUnknown(main.otherText);
    if (normToken(sp) === "other") sp = "";
    if (sp || ot || companionStr) {
      return {
        selectedPreset: sp,
        otherText: ot || companionStr,
      };
    }
  }

  const mainStr =
    typeof main === "string"
      ? main.trim()
      : main != null && typeof main !== "object"
        ? String(main).trim()
        : "";

  if (!options || options.length === 0) {
    return { selectedPreset: mainStr, otherText: companionStr };
  }

  if (!mainStr && !companionStr) {
    return { selectedPreset: "", otherText: "" };
  }

  if (normToken(mainStr) === "other") {
    return { selectedPreset: "", otherText: companionStr || "" };
  }

  const matchedMain = matchOptionLabel(mainStr, options);
  if (mainStr && matchedMain) {
    return { selectedPreset: matchedMain, otherText: companionStr };
  }

  if (mainStr && !matchedMain) {
    return { selectedPreset: "", otherText: companionStr || mainStr };
  }

  return { selectedPreset: "", otherText: companionStr };
}

export function isEmptyPresetWithOther(p: PresetWithOtherValue): boolean {
  return !p.selectedPreset.trim() && !p.otherText.trim();
}

/** Visible value: free text when present, else preset label. */
export function displayPresetWithOther(p: PresetWithOtherValue): string {
  const ot = p.otherText.trim();
  if (ot) return ot;
  return p.selectedPreset.trim();
}

export function presetWithOtherEquals(a: PresetWithOtherValue, b: PresetWithOtherValue): boolean {
  return (
    normToken(a.selectedPreset) === normToken(b.selectedPreset) && normToken(a.otherText) === normToken(b.otherText)
  );
}

/**
 * Read canonical value from snapshot, merging legacy `key` + `key_other` when needed.
 */
export function getPresetWithOtherFromData(
  data: Record<string, unknown>,
  key: string,
  options: readonly string[] | null
): PresetWithOtherValue {
  const main = data[key];
  const companion = data[legacyOtherKeyForPresetField(key)];
  return normalizePresetWithOtherFromUnknown(main, companion, options);
}
