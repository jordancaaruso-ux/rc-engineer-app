/**
 * Normalizes Awesomatix motor mount / top deck screw selections from OCR, PDF import,
 * Prisma JSON, and legacy shapes into canonical string[] values for storage.
 * All entry points are defensive: never throw; never call .map on non-arrays.
 */

export const MOTOR_MOUNT_SCREW_ORDER = ["1", "2", "3", "4", "5"] as const;
export const TOP_DECK_SCREW_ORDER = ["a", "b", "c", "d", "e", "f"] as const;
/** Top deck cuts use a distinct 8-position grid (A–H). */
export const TOP_DECK_CUTS_ORDER = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const MOTOR_SET = new Set<string>(MOTOR_MOUNT_SCREW_ORDER);
const TOP_SET = new Set<string>(TOP_DECK_SCREW_ORDER);
const CUT_SET = new Set<string>(TOP_DECK_CUTS_ORDER);

/** First matching key wins (minimal legacy object unwrapping). */
const WRAP_KEYS = [
  "selected",
  "values",
  "items",
  "value",
  "motorMountScrews",
  "topDeckScrews",
  "topDeckCuts",
  "motor_mount_screws",
  "top_deck_screws",
  "top_deck_cuts",
] as const;

/** Official sheet order — used for flex layout left→right. */
export const motorMountScrewPositions = MOTOR_MOUNT_SCREW_ORDER.map((id) => ({
  id,
  label: id,
}));

export const topDeckScrewPositions = TOP_DECK_SCREW_ORDER.map((id) => ({
  id,
  label: id.toUpperCase(),
}));

export const topDeckCutsPositions = TOP_DECK_CUTS_ORDER.map((id) => ({
  id,
  label: id.toUpperCase(),
}));

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object") return false;
  if (Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

/**
 * If `input` is a plain object with a known payload property, return that value.
 * Otherwise: `null` for empty/unwrappable objects; non-objects return as-is (caller decides).
 */
export function extractCandidateValue(input: unknown): unknown {
  try {
    if (input === null || input === undefined) return null;
    if (!isPlainObject(input)) return input;
    for (const k of WRAP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
      const v = input[k];
      if (v != null) return v;
    }
    return null;
  } catch {
    return null;
  }
}

function splitDelimitedString(s: string): string[] {
  return s
    .split(/(?:\s*[,;/+|]\s*|\s*;\s*|\s+)/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function arrayToTokens(arr: unknown[]): string[] {
  const out: string[] = [];
  for (const item of arr) {
    if (item === null || item === undefined) continue;
    if (typeof item === "string") {
      out.push(...splitDelimitedString(item));
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      out.push(String(item));
      continue;
    }
    if (typeof item === "boolean") continue;
    if (Array.isArray(item)) {
      out.push(...arrayToTokens(item));
      continue;
    }
    if (isPlainObject(item)) {
      const inner = extractCandidateValue(item);
      if (inner != null && inner !== item) {
        out.push(...toTokenList(inner));
      }
      continue;
    }
  }
  return out;
}

/**
 * Flattens unknown input into raw string tokens (not yet filtered by allowed sheet ids).
 */
export function toTokenList(input: unknown): string[] {
  try {
    if (input === null || input === undefined) return [];
    if (typeof input === "string") return splitDelimitedString(input);
    if (typeof input === "number" && Number.isFinite(input)) {
      return splitDelimitedString(String(input));
    }
    if (typeof input === "boolean") return [];
    if (Array.isArray(input)) return arrayToTokens(input);
    if (isPlainObject(input)) {
      const inner = extractCandidateValue(input);
      if (inner === null) return [];
      if (inner === input) return [];
      return toTokenList(inner);
    }
    return [];
  } catch {
    return [];
  }
}

function normalizeSelectionArray(
  tokens: string[],
  allowed: Set<string>,
  order: readonly string[]
): string[] | null {
  try {
    const normalized = tokens.map((t) => t.trim()).filter((t) => t.length > 0);
    const filtered = normalized.filter((t) => allowed.has(t));
    const uniq = [...new Set(filtered)];
    uniq.sort((a, b) => order.indexOf(a as never) - order.indexOf(b as never));
    return uniq.length > 0 ? uniq : null;
  } catch {
    return null;
  }
}

/**
 * Full pipeline: unwrap legacy objects, tokenize, filter to allowed motor ids, dedupe, sort.
 */
export function normalizeMotorMountScrews(input: unknown): string[] | null {
  try {
    if (input === null || input === undefined) return null;
    let root: unknown = input;
    if (isPlainObject(input)) {
      const inner = extractCandidateValue(input);
      if (inner === null) return null;
      root = inner;
    }
    const tokens = toTokenList(root);
    return normalizeSelectionArray(tokens, MOTOR_SET, MOTOR_MOUNT_SCREW_ORDER);
  } catch {
    return null;
  }
}

/**
 * Full pipeline for top deck (a–f), lowercased before filtering.
 */
export function normalizeTopDeckScrews(input: unknown): string[] | null {
  try {
    if (input === null || input === undefined) return null;
    let root: unknown = input;
    if (isPlainObject(input)) {
      const inner = extractCandidateValue(input);
      if (inner === null) return null;
      root = inner;
    }
    const tokens = toTokenList(root).map((t) => t.toLowerCase());
    return normalizeSelectionArray(tokens, TOP_SET, TOP_DECK_SCREW_ORDER);
  } catch {
    return null;
  }
}

/**
 * Top deck cuts: same token pipeline as top deck screws, but allows a–h.
 */
export function normalizeTopDeckCuts(input: unknown): string[] | null {
  try {
    if (input === null || input === undefined) return null;
    let root: unknown = input;
    if (isPlainObject(input)) {
      const inner = extractCandidateValue(input);
      if (inner === null) return null;
      root = inner;
    }
    const tokens = toTokenList(root).map((t) => t.toLowerCase());
    return normalizeSelectionArray(tokens, CUT_SET, TOP_DECK_CUTS_ORDER);
  } catch {
    return null;
  }
}
