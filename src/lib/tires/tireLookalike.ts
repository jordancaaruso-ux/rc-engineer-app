import { normalizeSearchText } from "@/lib/search/optionSearch";

/** Words a driver adds or drops without meaning another tire ("Raw Speed RC Radar" / "Raw Speed Radar"). */
const NOISE_WORDS = new Set(["rc", "tire", "tires", "tyre", "tyres"]);

/**
 * A name as the words a driver would say, letters and numbers apart: "J13", "J-13" and "J 13" are
 * all `j 13`, so how it was punctuated stops mattering.
 */
function tireWords(name: string): string[] {
  return normalizeSearchText(name)
    .split(" ")
    .flatMap((w) => w.match(/[a-z]+|\d+/g) ?? [])
    .filter((w) => !NOISE_WORDS.has(w));
}

export type TireLookalikeRow = { id: string; displayName: string };

/**
 * The catalog tire a hand-typed one plainly IS, written another way — or null.
 *
 * Plainly means the same words: in any order, ignoring case, spacing, hyphens and "RC"
 * ("Jetko J13 Soft" is "Jetko J-13 Soft"; "Jetko J-One Soft Composite" is "Jetko J-One Composite
 * Soft"), or the same letters run together ("Proline M4" is "Pro-Line M4").
 *
 * Deliberately stricter than the picker's search score, which it must not reuse. This feeds the
 * one-tap merge on the founder's review page, and a merge moves a driver's runs and deletes the
 * row, so a near miss must never be offered. Measured on the real catalog 2026-09-26, the search
 * score's best match for a driver's "Green" is "Avid RC Guardian A3 Medium Green", and for "Jetko
 * J-One Super Soft Composite" it is "Jetko J-One Super Soft" — a different tire. Anything short of
 * the same words is left to the founder's own search.
 *
 * Build once per catalog, then ask per name.
 */
export function tireLookalikeFinder<T extends TireLookalikeRow>(
  catalog: readonly T[]
): (name: string) => T | null {
  const bySortedWords = new Map<string, T>();
  const byRunTogether = new Map<string, T>();
  for (const row of catalog) {
    const words = tireWords(row.displayName);
    if (words.length === 0) continue;
    const sorted = [...words].sort().join(" ");
    const together = words.join("");
    if (!bySortedWords.has(sorted)) bySortedWords.set(sorted, row);
    if (!byRunTogether.has(together)) byRunTogether.set(together, row);
  }
  return (name) => {
    const words = tireWords(name);
    if (words.length === 0) return null;
    return (
      bySortedWords.get([...words].sort().join(" ")) ?? byRunTogether.get(words.join("")) ?? null
    );
  };
}
