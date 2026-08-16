/**
 * One string that stands for a whole setup, so "has this changed?" can be answered by comparing two
 * of them.
 *
 * ============================== WHY IT EXISTS ==============================
 *
 * The save bar used to track a `dirty` BOOLEAN that was armed by any call to the editor's `onChange`
 * — a "was touched" flag, never a comparison. Three things armed it without the driver changing a
 * single number:
 *
 * 1. Opening a setup at all, in dev. React StrictMode mounts every effect twice on the same
 *    instance, so the sheet's own skip-the-first-notify ref is already spent on the second pass and
 *    it hands its values straight back to the parent. The flag cannot tell that from an edit.
 * 2. Tapping into a grid field and back out. `SetupSheetView` commits on blur whatever happened,
 *    so a stray tap while reading the sheet counted as work.
 * 3. Ticking a box on and off again, or retyping the number that was already there. Once armed,
 *    nothing but a save could ever disarm it.
 *
 * A comparison has none of those failure modes, and gains the one the flag could never have: the
 * bar goes quiet again when the driver puts a value back.
 *
 * ============================== WHAT "THE SAME" MEANS ==============================
 *
 * Two setups are the same when they would STORE the same, not when their objects match:
 *
 * - Key order is meaningless — sorted.
 * - Empty is absent. `""`, `null`, `undefined` and an empty list all read as an unfilled box, and a
 *   box that was never filled is not a change when it stays unfilled.
 * - Numbers are numbers. `5.50` typed over a stored `5.5` is the same ride height; the grid editor's
 *   `coerceSetupValue` would write the identical row. Text stays text and stays CASE-SENSITIVE —
 *   fixing a tyre name's capitalisation really would be written, so it really is a change.
 * - Lists keep their order, because the screw fields carry meaning in theirs.
 *
 * Nested shapes (`PresetWithOtherValue`, `TireSelectionValue`) go through the same rules, so a
 * preset that resolves to the same thing by a different route is one value, not two.
 */

/**
 * Values as they would be stored, with everything meaningless to a comparison removed. `undefined`
 * means "nothing here" — the caller drops the key entirely.
 */
function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "boolean") {
    // Ticks live as "1"/"" everywhere else in setup data; a real `true` is the same answer.
    return value ? "1" : undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? String(n) : trimmed;
  }

  if (Array.isArray(value)) {
    const items = value.map(canonicalValue).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const canonical = canonicalValue(source[key]);
      if (canonical !== undefined) out[key] = canonical;
    }
    return Object.keys(out).length ? out : undefined;
  }

  // A function or a symbol in setup data is a bug elsewhere, not a value.
  return undefined;
}

/** The keys whose values differ, sorted. Empty means the two setups would store the same row. */
export function changedSetupKeys(a: unknown, b: unknown): string[] {
  const left = canonicalRecord(a);
  const right = canonicalRecord(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function canonicalRecord(values: unknown): Record<string, unknown> {
  const canonical = canonicalValue(values);
  return canonical && typeof canonical === "object" && !Array.isArray(canonical)
    ? (canonical as Record<string, unknown>)
    : {};
}

/**
 * A stable string for one setup. Equal fingerprints mean equal setups; the string itself is not
 * meant to be read, stored, or sent anywhere.
 */
export function setupValuesFingerprint(values: unknown): string {
  return JSON.stringify(canonicalRecord(values));
}
