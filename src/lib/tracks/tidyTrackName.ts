/**
 * Mechanical tidy for track names and places copied from LiveRC or Speedhive: ALL CAPS and all
 * lowercase only, the words themselves never change. Shared by the catalog import, the rename of
 * driver-added tracks, and the add-track forms taking a Speedhive name — so every name copied from
 * a timing site is written the same way.
 */

const SMALL_WORDS = new Set(["and", "of", "at", "the", "in", "on", "de", "la", "du", "del", "y"]);
/** "st leonards" is Saint, not an acronym. */
const PLACE_ABBREVIATIONS = new Set(["st", "mt", "ft", "pt"]);

/** Real words that an all-caps name would otherwise keep shouting as if they were initials. */
const COMMON_SHORT_WORDS = new Set([
  "the", "one", "two", "way", "big", "top", "pro", "fun", "hot", "old", "new", "red", "car", "mud",
  "hub", "pit", "run", "bay", "oak", "elm", "fox", "owl", "sun", "ace", "all", "air", "zoo", "far",
  "box", "key", "sky", "ice", "lab", "den", "pad", "hut", "cup", "day", "jet",
]);

function capitalise(word: string): string {
  return word.replace(/(^|[-'/(])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 6 && text === text.toUpperCase();
}

function isAllLower(text: string): boolean {
  return /[a-z]/.test(text) && text === text.toLowerCase();
}

/** "207 RC SPEEDWAY" → "207 RC Speedway"; "miami" → "Miami". Mixed case is left exactly as typed. */
export function tidyName(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const caps = isAllCaps(text);
  if (!caps && !isAllLower(text)) return text;
  const split = text.split(" ");
  // A one-word all-caps name is a club acronym ("ACTMCRC", "NSWRCRCC"), not shouting.
  if (caps && split.length === 1) return text;
  return split
    .map((word, i) => {
      if (/^r\.?\/?c\.?$/i.test(word)) return word.toUpperCase();
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (lower === "st.") return "St.";
      const letters = word.replace(/[^A-Za-z]/g, "");
      // No vowel = an acronym in either case: "CBRC", "JMHRC", "zrh" → "ZRH".
      const noVowel =
        letters.length >= 2 &&
        letters.length <= 5 &&
        !/[aeiouy]/i.test(letters) &&
        !PLACE_ABBREVIATIONS.has(letters.toLowerCase());
      if (noVowel) return word.toUpperCase();
      if (caps) {
        // Codes and club initials: "28SRA", "R.C.", "MPR", "RCCA", "SACC".
        if (/\d|\./.test(word)) return word;
        if (/^[A-Z]{2,3}$/.test(word) && !COMMON_SHORT_WORDS.has(lower)) return word;
        if (/^RC[A-Z]{1,3}$|^[A-Z]{2}CC$/.test(word)) return word;
      }
      return capitalise(lower);
    })
    .join(" ");
}

export function tidyPlace(raw: string | null): string | null {
  const text = raw?.trim().replace(/\s+/g, " ");
  if (!text) return null;
  // State codes stay codes: "NSW", "ON".
  if (/^[A-Za-z]{2,3}$/.test(text)) return text.toUpperCase();
  return isAllCaps(text) || isAllLower(text) ? tidyName(text) : text;
}
