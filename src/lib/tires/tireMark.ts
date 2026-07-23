/**
 * A tire set's optional physical "mark" — a short code the driver writes on the
 * sidewall (or a race-control mark). It's how you tell two sets of the same
 * compound apart when wear alone isn't enough. Free text for now; number-only
 * can be enforced later by tightening normalizeTireMark.
 */
export const TIRE_MARK_MAX = 4;

/** Trim, collapse internal whitespace, cap length; empty → null. */
export function normalizeTireMark(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, TIRE_MARK_MAX).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Shared display string, e.g. "Marked 7". Null when unmarked. */
export function formatMark(mark: string | null | undefined): string | null {
  const m = normalizeTireMark(mark);
  return m ? `Marked ${m}` : null;
}

/**
 * The number to suggest for a new/unnamed set: the LOWEST free positive integer among the given
 * marks — so numbers recycle as sets are retired and you stay in single digits (never "set 35").
 * Non-numeric marks ("A2", "RED") are valid but ignored here; the suggestion is only ever a number.
 */
export function suggestTireMark(existingMarks: Array<string | null | undefined>): string {
  const taken = new Set<number>();
  for (const raw of existingMarks) {
    const m = normalizeTireMark(raw);
    if (m != null && /^\d+$/.test(m)) taken.add(parseInt(m, 10));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return String(n);
}
