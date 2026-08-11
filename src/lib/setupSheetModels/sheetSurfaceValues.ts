import {
  fieldUsesPresetWithOther,
  legacyOtherKeyForPresetField,
  normalizePresetWithOtherFromUnknown,
  scalarSetupTextFromUnknown,
} from "@/lib/setup/presetWithOther";
import type { SheetPlanField } from "@/lib/setupSheetModels/sheetPlan";

/**
 * Stored setup values ↔ the strings the sheet surface draws and edits.
 *
 * The sheet surface holds one string per box key — that is what typing into a box produces. But a
 * SAVED Awesomatix setup holds richer shapes: a many-of-many is an array, a preset-with-other row
 * is `{ selectedPreset, otherText }`, numbers are numbers. Every consumer of a snapshot — the
 * change list, comparisons, aggregation — reads those stored shapes, so the sheet must give back
 * EXACTLY the shapes the form gives back, or saving a setup from the sheet would make every value
 * look changed against one saved from the form.
 *
 * Going TO the surface is value-driven — the stored value says what it is. Coming BACK needs the
 * plan, because "a, b" alone doesn't say whether it is a list or a sentence; `SheetPlanField.multi`
 * and the preset-with-other key list say.
 */

const MULTI_SEPARATOR = ", ";

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Split a surface multi string back into tokens. Tolerates hand-typed separators. */
export function splitMultiSurfaceValue(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this option currently on, given the field's stored-as-string surface value? */
export function optionSelectedInSurfaceValue(
  surfaceValue: string,
  optionValue: string,
  multi: boolean
): boolean {
  if (!surfaceValue.trim() || !optionValue.trim()) return false;
  if (multi) return splitMultiSurfaceValue(surfaceValue).some((t) => norm(t) === norm(optionValue));
  return norm(surfaceValue) === norm(optionValue);
}

/** Toggle one option in a surface value; single-select toggles off when re-tapped. */
export function toggleOptionInSurfaceValue(
  surfaceValue: string,
  optionValue: string,
  multi: boolean
): string {
  if (!multi) {
    return norm(surfaceValue) === norm(optionValue) ? "" : optionValue;
  }
  const tokens = splitMultiSurfaceValue(surfaceValue);
  const without = tokens.filter((t) => norm(t) !== norm(optionValue));
  if (without.length !== tokens.length) return without.join(MULTI_SEPARATOR);
  return [...tokens, optionValue].join(MULTI_SEPARATOR);
}

/**
 * Stored snapshot data → surface strings.
 *
 * Value-driven on purpose: it runs before the plan has arrived, and a stored value already says
 * what shape it is. Preset-with-other objects split into the base key + the `_other` companion —
 * the two boxes the paper prints for that row.
 */
export function storedValuesToSurface(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(data)) {
    if (raw == null) continue;
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const rec = raw as Record<string, unknown>;
      if ("selectedPreset" in rec || "otherText" in rec) {
        const preset = scalarSetupTextFromUnknown(rec.selectedPreset);
        const other = scalarSetupTextFromUnknown(rec.otherText);
        if (preset) out[key] = preset;
        const companion = legacyOtherKeyForPresetField(key);
        if (other && !(companion in data)) out[companion] = other;
        continue;
      }
    }
    if (Array.isArray(raw)) {
      const tokens = raw.map((v) => scalarSetupTextFromUnknown(v)).filter(Boolean);
      if (tokens.length) out[key] = tokens.join(MULTI_SEPARATOR);
      continue;
    }
    if (typeof raw === "boolean") {
      if (raw) out[key] = "1";
      continue;
    }
    const text = scalarSetupTextFromUnknown(raw);
    if (text) out[key] = text;
  }
  return out;
}

/**
 * Surface strings → the stored shapes every other setup reader expects.
 *
 * `fields` is the sheet plan's field list; a key the plan doesn't know (a companion `_other`
 * consumed by its base, or a stray) passes through as its string, which is what the storage
 * normaliser has always received for unknown keys.
 */
export function surfaceValuesToStored(
  surface: Record<string, string>,
  fields: readonly SheetPlanField[]
): Record<string, unknown> {
  const fieldByKey = new Map(fields.map((f) => [f.key, f] as const));

  // Preset-with-other rows own their `_other` companion: the pair composes into ONE stored
  // object, so the companion never writes a key of its own.
  const presetBases = fields.filter((f) => fieldUsesPresetWithOther(f.key, f.options ?? null));
  const companionToBase = new Map(presetBases.map((f) => [legacyOtherKeyForPresetField(f.key), f] as const));
  const presetBaseKeys = new Set(presetBases.map((f) => f.key));

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(surface)) {
    if (presetBaseKeys.has(key) || companionToBase.has(key)) continue;
    const field = fieldByKey.get(key);

    if (field?.multi) {
      const tokens = splitMultiSurfaceValue(value);
      if (tokens.length) out[key] = canonicalizeTokens(tokens, field);
      continue;
    }

    if (!value.trim()) continue;
    out[key] = field?.optionValues?.length ? canonicalizeToken(value, field) : value;
  }

  for (const field of presetBases) {
    const preset = surface[field.key] ?? "";
    const otherText = surface[legacyOtherKeyForPresetField(field.key)] ?? "";
    if (!preset.trim() && !otherText.trim()) continue;
    out[field.key] = normalizePresetWithOtherFromUnknown(preset, otherText, field.options ?? null);
  }

  return out;
}

/**
 * `surfaceValuesToStored` plus explicit deletion markers, for callers that MERGE into an existing
 * setup rather than replace it (the log-run form). A box the driver cleared must come through as
 * `""` — absent would leave the old value standing, and a blank box the driver made blank is a
 * decision, not a no-op.
 */
export function surfaceValuesToStoredMerge(
  surface: Record<string, string>,
  fields: readonly SheetPlanField[]
): Record<string, unknown> {
  const stored = surfaceValuesToStored(surface, fields);
  const out: Record<string, unknown> = { ...stored };
  for (const key of Object.keys(surface)) {
    if (key in out) continue;
    // A cleared box, or a `_other` companion whose text now lives inside its base's object —
    // either way this KEY holds nothing any more, and the merge must be told so.
    out[key] = "";
  }
  return out;
}

/** The schema's own casing for a typed/tapped token, when the field declares options. */
function canonicalizeToken(value: string, field: SheetPlanField): string {
  for (const v of field.optionValues ?? []) {
    if (norm(v) === norm(value)) return v;
  }
  return value;
}

function canonicalizeTokens(tokens: string[], field: SheetPlanField): string[] {
  return tokens.map((t) => canonicalizeToken(t, field));
}
