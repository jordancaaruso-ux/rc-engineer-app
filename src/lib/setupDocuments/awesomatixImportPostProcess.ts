import { canonicalSetupFieldKey, normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import { normalizeSetupSnapshotForStorage, type SetupSnapshotData } from "@/lib/runSetup";
import {
  getCalibrationFieldKind,
  getSingleSelectChipOptions,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { isMultiSelectFieldKey, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import {
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
} from "@/lib/setup/presetWithOther";

/**
 * Awesomatix PDF → setup: coerce obviously wrong AcroForm reads before saving to snapshot.
 * Does not fix wrong calibration targets — only rejects known-bad patterns and extracts cSt when embedded.
 */

export type AwesomatixSanitizeResult = {
  value: string;
  /** Appended to debug raw line */
  note?: string;
  warning?: string;
};

/** Viscosity: digits only, 2–4 digits typical (e.g. 350, 400). */
export function sanitizeDamperOilImported(raw: string): AwesomatixSanitizeResult {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { value: "" };

  const compact = t.replace(/\s/g, "");
  if (/^\d{2,4}$/.test(compact)) return { value: compact };

  const embedded = t.match(/\b(\d{2,4})\b/);
  if (embedded) {
    return {
      value: embedded[1]!,
      note: `extracted ${embedded[1]} from "${t}"`,
    };
  }

  const partish =
    /^am\d/i.test(compact)
    || /^[a-z]{2}\d{2}[a-z0-9-]*$/i.test(compact)
    || /^xm\d/i.test(compact);
  if (partish) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: "Looks like a part / label token, not cSt — map the numeric damper oil field.",
    };
  }

  return { value: t };
}

export function sanitizeBodyshellOrWingImported(raw: string, field: "bodyshell" | "wing"): AwesomatixSanitizeResult {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { value: "" };
  if (/^\.\d+$/.test(t)) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: `Bare decimal in ${field} — wrong PDF field; map the ${field} name field.`,
    };
  }
  return { value: t };
}

/** Spring final value must be STD or S when using checkbox groups; reject ST019-style part strings. */
export function sanitizeSpringImported(raw: string): AwesomatixSanitizeResult {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { value: "" };
  const u = t.toUpperCase();
  if (u === "STD" || u === "STANDARD") return { value: "STD" };
  if (u === "S") return { value: "S" };
  if (/^ST\d+/i.test(t)) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: "Part-style spring text — map Spring as STD/S widget group.",
    };
  }
  return { value: t };
}

/** Damper dial (typical 60–100). Rejects PSS row labels like `15-25` and PSS-only values. */
export function sanitizeDamperPercentDialImported(raw: string): AwesomatixSanitizeResult {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { value: "" };
  if (/\d+\s*[-–]\s*\d+/.test(t)) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: "Range text — map the damper % dial field, not a label/PSS row.",
    };
  }
  const n = parseInt(t.replace(/%/g, "").trim(), 10);
  if (!Number.isFinite(n)) return { value: "", note: `raw: ${JSON.stringify(t)}` };
  if (n >= 50 && n <= 100) return { value: String(n) };
  if (n === 30 || n === 25 || n === 15) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: "This value belongs in PSS % (30/25/15), not damper % dial.",
    };
  }
  return {
    value: "",
    note: `raw: ${JSON.stringify(t)}`,
    warning: "Not a plausible damper dial % (expect ~50–100).",
  };
}

/** PSS row: exactly one of 30, 25, 15. */
export function sanitizePssPercentSetupImported(raw: string): AwesomatixSanitizeResult {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return { value: "" };
  if (t === "30" || t === "25" || t === "15") return { value: t };
  if (/\d+\s*[-–]\s*\d+/.test(t)) {
    return {
      value: "",
      note: `raw: ${JSON.stringify(t)}`,
      warning: "PSS must be one of 30 / 25 / 15 — map the PSS checkbox row.",
    };
  }
  return {
    value: "",
    note: `raw: ${JSON.stringify(t)}`,
    warning: "PSS % must be 30, 25, or 15.",
  };
}

export function applyAwesomatixSanitizer(appKey: string, imported: string): AwesomatixSanitizeResult {
  const key = canonicalSetupFieldKey(appKey);
  if (key === "damper_oil_front" || key === "damper_oil_rear") {
    return sanitizeDamperOilImported(imported);
  }
  if (key === "bodyshell") return sanitizeBodyshellOrWingImported(imported, "bodyshell");
  if (key === "wing") return sanitizeBodyshellOrWingImported(imported, "wing");
  if (key === "spring_front" || key === "spring_rear") {
    return sanitizeSpringImported(imported);
  }
  if (key === "damper_percent_front" || key === "damper_percent_rear") {
    return sanitizeDamperPercentDialImported(imported);
  }
  if (key === "pss_percent_setup_front" || key === "pss_percent_setup_rear") {
    return sanitizePssPercentSetupImported(imported);
  }
  return { value: imported };
}

/**
 * Canonical snake_case keys + field interpreters so review/setup always sees interpreted values
 * (fixes camelCase calibration keys skipping sanitizers, and bad text-parser fallbacks).
 */
export function interpretAwesomatixSetupSnapshot(input: unknown): SetupSnapshotData {
  const base = normalizeParsedSetupData(input);
  const out: SetupSnapshotData = {};
  for (const [k, v] of Object.entries(base)) {
    if (v == null) continue;
    const canonicalKey = canonicalSetupFieldKey(k);
    const kind = getCalibrationFieldKind(canonicalKey);
    if (kind === "visualMulti" || isMultiSelectFieldKey(canonicalKey)) {
      out[canonicalKey] = normalizeMultiSelectValue(canonicalKey, v);
      continue;
    }
    /**
     * `normalizeParsedSetupData` merges `*_other` text into `{ selectedPreset, otherText }` on the base key.
     * Do not pass that object through `String(v)` — it becomes "[object Object]" and then lands in `otherText`.
     */
    if (
      isPresetWithOtherFieldKey(canonicalKey)
      && typeof v === "object"
      && v !== null
      && !Array.isArray(v)
      && ("selectedPreset" in v || "otherText" in v)
    ) {
      const opts = getSingleSelectChipOptions(canonicalKey);
      const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
      if (!isEmptyPresetWithOther(pov)) out[canonicalKey] = pov;
      continue;
    }
    const s = String(v).trim();
    if (!s) continue;
    const res = applyAwesomatixSanitizer(k, s);
    const final = res.value.trim();
    if (final) out[canonicalKey] = final;
  }
  return normalizeSetupSnapshotForStorage(out);
}
