/**
 * Rank Speedhive practice locations against one of our tracks, for "Find on Speedhive".
 *
 * Pure, so the ranking is testable without MYLAPS. The directory itself is fetched per tap and
 * never stored (see `speedhivePracticeDirectory.ts`): MYLAPS' Conditions of Use 5.3 forbid copying
 * their data, so the only thing that lands in our database is the one link the driver picks.
 *
 * Speedhive names are club-typed and often codes ("NSWRCRCC", "PHDR-Main") with no town, so the
 * matcher leans on distinctive words, lets the town stand in for a name, and treats the country as
 * a strong tie-breaker rather than a filter — a user-created track usually has no country at all.
 */

export type PracticeLocationRow = {
  id: number;
  name?: string | null;
  country?: string | null;
  status?: string | null;
};

export type PracticeLocationMatch = {
  id: number;
  name: string;
  countryCode: string | null;
  url: string;
  score: number;
};

/** Words every RC venue shares — matching on them would rank half the directory equally. */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "rc", "r", "c", "raceway", "racing", "race", "track", "tracks", "speedway", "circuit", "club",
  "model", "models", "modelsport", "car", "cars", "auto", "hobby", "hobbies", "shop", "the", "and",
  "of", "at", "de", "del", "la", "le", "der", "inc", "llc", "ltd", "assn", "association", "on",
  "road", "offroad", "onroad", "off", "park", "arena", "main", "radio", "control", "controlled",
  "mini", "indoor", "outdoor", "center", "centre", "complex", "motorsport", "motorsports", "mc",
  "amc", "mac", "rcc", "rccc", "ev", "e", "v",
]);

export function practiceLocationUrl(id: number): string {
  return `https://speedhive.mylaps.com/practice/${id}`;
}

function words(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function distinctive(text: string | null | undefined): string[] {
  return words(text).filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
}

/** Two words match when equal, or when a long one starts with the other ("boronia" / "boroniarc"). */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

function overlap(query: string[], candidate: string[]): number {
  if (query.length === 0 || candidate.length === 0) return 0;
  let hits = 0;
  for (const q of query) if (candidate.some((c) => wordsMatch(q, c))) hits++;
  return hits / query.length;
}

/** Letters-only squash, so "Arena33 DJK" meets "arena 33 djk" and "NSWRCRCC" meets itself. */
function squash(text: string | null | undefined): string {
  return words(text).join("");
}

/** Words a club's initials skip — "Large Scale Club of Victoria" is LSCV, not LSCOV. */
const ACRONYM_SKIP: ReadonlySet<string> = new Set(["the", "and", "of", "at", "inc", "llc", "ltd"]);

/**
 * A club's initials, the way clubs write them: "South Eastern Radio Controlled Car Club" → serccc,
 * "Mornington Peninsula RC Car Club" → mprccc, "NSW Radio Control Racing Car Club" → nswrcrcc.
 * Speedhive names are often only the initials, so a driver typing the full name would otherwise
 * find nothing. "RC" and a short capitalised token ("NSW") count whole — except in a name typed all
 * in capitals, where every word is capitalised and "HOT" is just a word.
 */
function acronym(text: string | null | undefined): string {
  const raw = (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shouting = raw === raw.toUpperCase();
  let out = "";
  for (const token of raw.split(/[^A-Za-z0-9]+/)) {
    const lower = token.toLowerCase();
    if (!lower || /^\d+$/.test(lower) || ACRONYM_SKIP.has(lower)) continue;
    if (lower === "rc" || (!shouting && /^[A-Z]{2,5}$/.test(token))) out += lower;
    else out += lower[0];
  }
  return out;
}

export function rankPracticeLocations(
  rows: readonly PracticeLocationRow[],
  track: { name: string; location?: string | null; countryCode?: string | null },
  options: { limit?: number } = {}
): PracticeLocationMatch[] {
  const limit = options.limit ?? 5;
  const nameWords = distinctive(track.name);
  // "Town, ST" — the state abbreviation is noise against club names, the town is not.
  const townWords = distinctive((track.location ?? "").split(",")[0]);
  const trackSquash = squash(track.name);
  const trackAllWords = words(track.name);
  const trackAcronym = acronym(track.name);
  const country = track.countryCode?.trim().toLowerCase() || null;

  const scored: PracticeLocationMatch[] = [];
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name || !Number.isFinite(row.id)) continue;
    const candidateWords = distinctive(name);

    let score = overlap(nameWords, candidateWords) * 10;
    // The whole name inside theirs (or theirs inside ours) — catches squashed and coded names.
    const candidateSquash = squash(name);
    if (trackSquash.length >= 5 && candidateSquash.length >= 5) {
      if (candidateSquash.includes(trackSquash) || trackSquash.includes(candidateSquash)) score += 6;
    }
    // One side is the other's initials: "South Eastern Radio Controlled Car Club" ↔ "SERCCC Track".
    // Checked against every word, generic or not — "rccc" is generic, a club's initials are not.
    const candidateAcronym = acronym(name);
    if (
      (trackAcronym.length >= 4 && words(name).includes(trackAcronym)) ||
      (candidateAcronym.length >= 4 && trackAllWords.includes(candidateAcronym))
    ) {
      score += 10;
    }
    if (townWords.length > 0) score += overlap(townWords, candidateWords) * 4;
    if (score <= 0) continue;

    const rowCountry = row.country?.trim().toLowerCase() || null;
    if (country && rowCountry) score += rowCountry === country ? 3 : -4;
    // A location that has never gone online is usually a test decoder or a one-off event.
    if (row.status && row.status.toUpperCase() !== "OFFLINE") score += 0.5;

    if (score < 4) continue;
    scored.push({
      id: row.id,
      name,
      countryCode: rowCountry,
      url: practiceLocationUrl(row.id),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // A strong hit makes the weak tail noise: "AMCA Apeldoorn" should not come with a stray ".nl".
  const floor = (scored[0]?.score ?? 0) * 0.35;
  return scored.filter((m) => m.score >= floor).slice(0, limit);
}
