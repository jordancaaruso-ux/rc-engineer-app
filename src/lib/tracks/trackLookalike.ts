import { GENERIC_WORDS, acronym } from "@/lib/speedhive/matchPracticeLocations";

/**
 * The tracks already in the catalog that a name a driver is typing plainly means — "Knox Offroad"
 * is Knox Offroad RC Club — so the add-track forms can offer the existing club before a near-copy
 * is made (founder ruling 2026-09-26: near-copies are a must-fix before launch).
 *
 * POST /api/tracks already refuses the exact signals (same name, same LiveRC or Speedhive link, a
 * one-word name equal to a LiveRC host). This catches the spellings that slip past those: other
 * word orders, filler words dropped or added, a club's initials, a name inside a longer one.
 *
 * It only ever SUGGESTS. Two real clubs can share almost every word — RC Madness and RC Madness 2
 * are both in Enfield, Connecticut — so the form always keeps a way to make the new one.
 *
 * Pure, so the rules are testable against real catalog rows (trackLookalike.test.ts).
 */

export type TrackLookalikeRow = {
  id: string;
  name: string;
  location?: string | null;
  region?: string | null;
  countryCode?: string | null;
  liveRcUrl?: string | null;
  speedhiveUrl?: string | null;
  catalogEventCount?: number | null;
};

export type TrackLookalikeWhy = "same name" | "same words" | "LiveRC name" | "initials" | "name inside" | "same town";

export type TrackLookalike<T extends TrackLookalikeRow = TrackLookalikeRow> = {
  row: T;
  score: number;
  why: TrackLookalikeWhy;
};

/**
 * Words that say what kind of place a club is, not which one. The Speedhive matcher's list, less
 * "mini", "indoor" and "outdoor": for our own catalog those name the club ("Mini-Z Knox" is not
 * Knox Offroad RC Club; "Indoor Raceway" is a club in Stevenage).
 */
const FILLER: ReadonlySet<string> = new Set(
  [...GENERIC_WORDS, "incorporated", "society"].filter(
    (w) => w !== "mini" && w !== "indoor" && w !== "outdoor"
  )
);

/**
 * Place words many clubs share. They still count when they ARE the name ("West Coast" is West
 * Coast Model RC), but one of them in common is not enough: "Eastern Hills RC" is not the Eastern
 * Model Car Club.
 */
const WEAK: ReadonlySet<string> = new Set([
  "north", "south", "east", "west", "northern", "southern", "eastern", "western", "central",
  "city", "county", "district", "valley", "hills", "hill", "coast", "bay", "lake", "river",
  "mount", "mountain", "national", "state", "international", "united", "royal", "grand", "new",
  "old", "upper", "lower", "greater", "metro", "regional", "country",
]);

/** A word that picks out a club on its own: four letters or more, not a number, not a place word. */
function strong(w: string): boolean {
  return w.length >= 4 && !/^\d+$/.test(w) && !WEAK.has(w);
}

function words(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The words that pick out one club: filler dropped, single letters dropped, numbers always kept. */
function coreWords(text: string | null | undefined): string[] {
  return words(text).filter((w) => /^\d+$/.test(w) || (w.length > 1 && !FILLER.has(w)));
}

function numbersIn(core: readonly string[]): string[] {
  return core.filter((w) => /^\d+$/.test(w)).sort();
}

/** "https://serccc.liverc.com/…" → "serccc". */
function liveRcHost(url: string | null | undefined): string | null {
  const m = /^https?:\/\/([a-z0-9-]+)\.liverc\.com/i.exec(url?.trim() ?? "");
  return m ? m[1].toLowerCase() : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((w, i) => w === sb[i]);
}

/** Every word of `small` is a whole word of `big`. */
function containsAll(big: readonly string[], small: readonly string[]): boolean {
  return small.every((w) => big.includes(w));
}

type Prepared<T extends TrackLookalikeRow> = {
  row: T;
  squash: string;
  core: string[];
  coreSquash: string;
  numbers: string[];
  initials: string;
  host: string | null;
  placeWords: string[];
};

function prepare<T extends TrackLookalikeRow>(row: T): Prepared<T> {
  const core = coreWords(row.name);
  return {
    row,
    squash: words(row.name).join(""),
    core,
    coreSquash: core.join(""),
    numbers: numbersIn(core),
    initials: acronym(row.name),
    host: liveRcHost(row.liveRcUrl),
    placeWords: words(`${row.location ?? ""} ${row.region ?? ""}`),
  };
}

export type TrackLookalikeOptions = {
  /** The town or state the driver typed in the add form, when they typed one. */
  location?: string | null;
  /** Countries this driver races in (their favourites and runs). Foreign rows need a strong match. */
  homeCountries?: readonly string[];
  limit?: number;
};

/** Below this, a row from a country the driver doesn't race in stays hidden. */
const FOREIGN_MIN_SCORE = 90;

/**
 * Build once per catalog read, then ask per typed name. Returns at most `limit` rows (default 3),
 * strongest first; an empty list when the name is too short or only filler ("RC Raceway Club").
 */
export function trackLookalikeFinder<T extends TrackLookalikeRow>(
  catalog: readonly T[]
): (typed: string, options?: TrackLookalikeOptions) => TrackLookalike<T>[] {
  const rows = catalog.filter((r) => r.name?.trim()).map(prepare);

  return (typed, options = {}) => {
    const text = typed.trim();
    if (text.length < 3) return [];
    const typedCore = coreWords(text);
    if (typedCore.length === 0) return [];
    const typedSquash = words(text).join("");
    const typedCoreSquash = typedCore.join("");
    const typedNumbers = numbersIn(typedCore);
    const typedInitials = acronym(text);
    const typedPlace = coreWords(options.location).filter((w) => w.length >= 3);
    const home = new Set((options.homeCountries ?? []).map((c) => c.toLowerCase()));

    const found: TrackLookalike<T>[] = [];
    for (const p of rows) {
      // "RC Madness 3" is never RC Madness 2. A number on only one side is fine: someone typing
      // "RC Madness 2" should still be shown RC Madness, and can say it's a different club.
      if (typedNumbers.length > 0 && p.numbers.length > 0 && !sameSet(typedNumbers, p.numbers)) continue;

      let score = 0;
      let why: TrackLookalikeWhy = "same words";
      if (typedSquash.length >= 3 && typedSquash === p.squash) {
        score = 100;
        why = "same name";
      } else if (p.core.length > 0 && (sameSet(typedCore, p.core) || typedCoreSquash === p.coreSquash)) {
        score = 90;
        why = "same words";
      } else if (
        p.host &&
        (typedCoreSquash === p.host || typedSquash === p.host || (typedInitials.length >= 3 && typedInitials === p.host))
      ) {
        score = 85;
        why = "LiveRC name";
      } else if (
        (typedInitials.length >= 4 && (typedInitials === p.initials || typedInitials === p.squash)) ||
        (typedSquash.length >= 4 && typedSquash === p.initials)
      ) {
        score = 75;
        why = "initials";
      } else if (p.core.length > 0) {
        const [small, big] = typedCore.length <= p.core.length ? [typedCore, p.core] : [p.core, typedCore];
        if (small.some(strong) && containsAll(big, small)) {
          score = 60;
          why = "name inside";
        } else if (
          typedPlace.length > 0 &&
          typedPlace.some((w) => p.placeWords.includes(w)) &&
          typedCore.some((w) => strong(w) && p.core.includes(w))
        ) {
          score = 50;
          why = "same town";
        }
      }
      if (score === 0) continue;

      if (typedPlace.length > 0 && typedPlace.some((w) => p.placeWords.includes(w))) score += 10;
      const country = p.row.countryCode?.toLowerCase() ?? null;
      const isHome = home.size === 0 || (country != null && home.has(country));
      if (!isHome && country != null && score < FOREIGN_MIN_SCORE) continue;
      found.push({ row: p.row, score, why });
    }

    const homeRank = (r: T) => {
      const c = r.countryCode?.toLowerCase();
      return c && home.has(c) ? 0 : 1;
    };
    found.sort(
      (a, b) =>
        b.score - a.score ||
        homeRank(a.row) - homeRank(b.row) ||
        (b.row.catalogEventCount ?? 0) - (a.row.catalogEventCount ?? 0) ||
        a.row.name.localeCompare(b.row.name)
    );
    return found.slice(0, options.limit ?? 3);
  };
}
