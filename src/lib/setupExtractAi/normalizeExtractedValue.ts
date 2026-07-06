/**
 * Value normalization + comparison shared by dual-pass agreement and the eval harness.
 * Deliberately forgiving about formatting (units, case, decimal commas) and strict about content.
 */

const UNIT_SUFFIX_RE = /\s*(?:\/?(?:mm|cst|deg(?:r|rees)?|sec|g|t|%|°c?)\.?)+$/i;

export function normalizeExtractedValue(raw: string): string {
  let v = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (!v) return "";
  // Strip unit suffixes only when a number remains ("5.8 /mm" → "5.8"), so ordinal
  // and word values ("1st", "asphalt") survive intact.
  const stripped = v.replace(UNIT_SUFFIX_RE, "").trim();
  if (stripped !== v && /\d$/.test(stripped)) v = stripped;
  // Decimal comma → dot ("2,5" → "2.5") when it reads as a single number.
  if (/^-?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  // Drop a trailing degree marker left after unit stripping ("1.8°").
  v = v.replace(/°$/, "").trim();
  return v;
}

/** True when two raw values mean the same thing after normalization. */
export function extractedValuesMatch(a: string, b: string): boolean {
  const na = normalizeExtractedValue(a);
  const nb = normalizeExtractedValue(b);
  if (na === nb) return true;
  // Numeric equality ("5.0" vs "5", "10k" is NOT numeric so falls through).
  const fa = Number(na);
  const fb = Number(nb);
  if (na !== "" && nb !== "" && Number.isFinite(fa) && Number.isFinite(fb)) return fa === fb;
  return false;
}

/**
 * Eval-side comparison: expected gold value (plus optional accepted alternates)
 * against an extracted value.
 */
export function matchesExpected(input: {
  extracted: string;
  expected: string;
  accept?: string[];
}): boolean {
  if (extractedValuesMatch(input.extracted, input.expected)) return true;
  for (const alt of input.accept ?? []) {
    if (extractedValuesMatch(input.extracted, alt)) return true;
  }
  return false;
}
