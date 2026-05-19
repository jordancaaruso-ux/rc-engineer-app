/**
 * KB-authoritative setup-key physics for keys whose **shim count** does not match the
 * plain-English field name (e.g. more toe-gain shims → less toe gain in bump).
 *
 * Source of truth: `content/vehicle-dynamics/bump-steer-toe-gain.md`
 * Do not invent directions here — only keys explicitly documented in that file.
 */

export type KbMechanismId = "front_bump_steer" | "rear_toe_gain";
export type KbMechanismDirection = "more" | "less";

export type KbSetupKeyConvention = {
  key: string;
  kbSource: "bump-steer-toe-gain.md";
  /** Effect when the stored numeric value (shim count) increases. */
  whenValueIncreases: string;
  /** Effect when the stored numeric value (shim count) decreases. */
  whenValueDecreases: string;
  mechanism: KbMechanismId;
  /** Mechanism effect when the key's numeric value goes UP (see setupMechanismMap). */
  mechanismWhenValueIncreases: KbMechanismDirection;
};

export type KbMechanismMapping = {
  mechanism: KbMechanismId;
  whenIncreasedEffect: KbMechanismDirection;
};

/** Keys with KB-defined shim-count ↔ on-track effect (non-obvious sign). */
const KB_CONVENTIONS: Record<string, KbSetupKeyConvention> = {
  bump_steer_shims_front: {
    key: "bump_steer_shims_front",
    kbSource: "bump-steer-toe-gain.md",
    whenValueIncreases: "more bump-in on compression",
    whenValueDecreases: "more bump-out on compression",
    mechanism: "front_bump_steer",
    mechanismWhenValueIncreases: "more",
  },
  toe_gain_shims_rear: {
    key: "toe_gain_shims_rear",
    kbSource: "bump-steer-toe-gain.md",
    whenValueIncreases: "more bump-out / less rear toe gain in compression",
    whenValueDecreases: "more bump-in / more rear toe gain in compression",
    mechanism: "rear_toe_gain",
    mechanismWhenValueIncreases: "less",
  },
};

export function kbConventionForSetupKey(key: string): KbSetupKeyConvention | null {
  return KB_CONVENTIONS[key] ?? null;
}

export function kbMechanismMappingsForKey(key: string): KbMechanismMapping[] {
  const c = kbConventionForSetupKey(key);
  if (!c) return [];
  return [{ mechanism: c.mechanism, whenIncreasedEffect: c.mechanismWhenValueIncreases }];
}

function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t || t === "—" || t === "-") return null;
  const cleaned = t
    .replace(/mm|gf\/mm|cst|wt|%|°/gi, "")
    .replace(",", ".")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Plain-English line for prompts / digests. Returns null when the key is not in the KB table.
 */
export function describeSetupChangePerKb(
  key: string,
  before: string,
  after: string
): string | null {
  const c = kbConventionForSetupKey(key);
  if (!c) return null;
  const b = parseNumber(before);
  const a = parseNumber(after);
  if (b == null || a == null || Math.abs(a - b) < 1e-4) {
    return `${c.key} (${c.kbSource}): ${before} → ${after}`;
  }
  const effect = a > b ? c.whenValueIncreases : c.whenValueDecreases;
  const shimWord = a > b ? "shim count increased" : "shim count decreased";
  return `${c.key} (${c.kbSource}): ${shimWord} (${before} → ${after}) → ${effect}. Do not equate shim count with the field label alone.`;
}

/** Compact convention lines for LLM prompts (one line per key). */
export function kbPhysicsPromptLinesForKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const c = kbConventionForSetupKey(key);
    if (!c) continue;
    seen.add(key);
    lines.push(
      `KB physics (${c.kbSource}) — \`${c.key}\`: more shims → ${c.whenValueIncreases}; fewer shims → ${c.whenValueDecreases}.`
    );
  }
  return lines;
}
