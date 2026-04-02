/**
 * Shared numeric parsing for setup imports, geometry sign rules, and derived calculations.
 * Handles European decimal commas, optional K suffix (e.g. 7.5K → 7500), and composite
 * strings by taking the first plausible scalar (e.g. "5.6/ Upstop 32.0mm" → 5.6).
 */

function normalizeDecimalCommasInNumericToken(s: string): string {
  let t = s.replace(/°/g, "").trim();
  t = t.replace(/\s+/g, "");
  if (/^\d{1,3}(,\d{3})+([.,]\d+)?$/.test(t)) {
    t = t.replace(/\./g, "").replace(/,(\d{1,4})$/, ".$1");
    return t;
  }
  t = t.replace(/(\d),(\d)/g, "$1.$2");
  return t;
}

function tryParsePlainNumber(t: string): number | null {
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Optional K / k suffix: 7.5K → 7500, 7,5k → 7500 */
function tryParseWithKSuffix(s: string): number | null {
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*([kK])$/);
  if (!m) return null;
  const base = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(base)) return null;
  return base * 1000;
}

/**
 * First `-?digits` with optional decimal comma/dot in the string (for composite PDF text).
 */
export function extractFirstNumericMagnitude(raw: string): number | null {
  const m = raw.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type ParseNumericOptions = {
  /** When false, values like "7.5K" are not expanded to 7500 (use for angles / mm). Default true. */
  allowKSuffix?: boolean;
};

/**
 * Parse a setup value that should be numeric (geometry, gaps, ratios, etc.).
 * Returns null only when no safe number can be inferred.
 */
export function parseNumericFromSetupString(raw: unknown, options?: ParseNumericOptions): number | null {
  const allowK = options?.allowKSuffix !== false;
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") {
    if (typeof raw === "object") return null;
    const s = String(raw).trim();
    if (!s) return null;
    return parseNumericFromSetupString(s, options);
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (allowK) {
    const k = tryParseWithKSuffix(trimmed.replace(/\s+/g, ""));
    if (k != null) return k;
  }

  const normalized = normalizeDecimalCommasInNumericToken(trimmed);
  const direct = tryParsePlainNumber(normalized);
  if (direct != null) return direct;

  const first = extractFirstNumericMagnitude(trimmed);
  if (first != null) return first;

  return null;
}
