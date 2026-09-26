/**
 * One scorer and one grouping rule behind every picker in the app.
 *
 * It started as the tire-type auto-matcher (`matchTireType`, which now delegates
 * here) and generalises without changing: RC part names are all the same shape —
 * a brand, a family, a number, sometimes a code nobody says out loud — so "sweep
 * 36", "SWEEP-36" and "36" all have to land on the same row. That is fuzzy token
 * work, not `String.includes`, and it should behave identically whether the
 * driver is picking a tire, a track, an additive or a past run. One
 * implementation is the only way that stays true.
 *
 * What a picker lists and how it orders it are two jobs. `matchesEveryWord` decides what is
 * listed: every typed word has to be in the option, and a number has to be a whole number there.
 * `scoreSearchMatch` only orders what passed. Until 2026-09-26 the score did both, and one shared
 * word was enough: "TT-02" offered a Formula car ending "F1-02", "RC Madness" listed 410 clubs,
 * "1/12" found only 1/10 pan tires (founder call after the launch test drive).
 */

/**
 * How many options it takes before scrolling beats reading.
 *
 * Below this, a list is something you find your row in by looking: a native
 * `<select>` is the better control, and a search field over it is a box that
 * never earns its space. Above it, the iOS wheel shows five rows at a time and
 * finding your entry means spinning blind past it — the complaint the picker
 * sheet exists to answer.
 *
 * 10 rather than a round 12 because `RunLayoutPicker` had already reached for
 * `searchable={layouts.length > 6}` by hand: the threshold that call site
 * arrived at independently is the honest signal about where the line sits.
 */
export const PICKER_SEARCH_THRESHOLD = 10;

/** Strip case, punctuation and a trailing "#2"-style set number down to bare tokens. */
export function normalizeSearchText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s*#\s*\d+\s*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well normalized `b` (the query) matches normalized `a` (a field), 0–100.
 *
 * The tiers matter more than the numbers: exact beats punctuation-insensitive
 * exact, which beats substring — so typing a full name never ranks below a
 * coincidental prefix — and anything else scores by the share of typed words
 * it holds. That last tier lets a sibling ("Sweep 32" for "sweep 36") score,
 * which the tire matcher's "Did you mean" still wants; a picker never lists one,
 * because `matchesEveryWord` decides what a picker lists.
 */
export function tokenOverlapScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const aCompact = a.replace(/\s+/g, "");
  const bCompact = b.replace(/\s+/g, "");
  if (aCompact === bCompact) return 95;
  if (a.includes(b) || b.includes(a)) return 85;
  if (aCompact.includes(bCompact) || bCompact.includes(aCompact)) return 82;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = b.split(" ").filter(Boolean);
  if (bTokens.length === 0) return 0;
  let hits = 0;
  for (const t of bTokens) {
    if (aTokens.has(t)) hits++;
  }
  const ratio = hits / bTokens.length;
  return Math.round(ratio * 70);
}

/**
 * Best score for `query` across several fields of one option — its label, plus
 * anything searchable that isn't on screen (a model code, a track's town). The
 * hidden fields are why "D32" finds a tire whose name never says D32.
 */
export function scoreSearchMatch(query: string, fields: Array<string | null | undefined>): number {
  const q = normalizeSearchText(query);
  if (!q) return 0;
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    const score = tokenOverlapScore(normalizeSearchText(field), q);
    if (score > best) best = score;
  }
  return best;
}

function isDigit(c: string | undefined): boolean {
  return c != null && c >= "0" && c <= "9";
}

/**
 * One normalized field, laid out for finding typed words in it: its words run together
 * (`compact`), where each word began, and every place a typed word may start — the start of a
 * word, or a switch between letters and digits inside one ("TC|10", "D|32", "4|WD"). `shown`
 * marks the name and detail line the driver reads, as against hidden codes and hosts.
 */
type WordField = {
  words: string[];
  compact: string;
  wordStarts: Set<number>;
  runStarts: number[];
  shown: boolean;
};

function toWordField(normalized: string, shown: boolean): WordField {
  const words = normalized.split(" ").filter(Boolean);
  const wordStarts = new Set<number>();
  const runStarts: number[] = [];
  let compact = "";
  for (const word of words) {
    wordStarts.add(compact.length);
    for (let i = 0; i < word.length; i++) {
      if (i === 0 || isDigit(word[i]) !== isDigit(word[i - 1])) runStarts.push(compact.length + i);
    }
    compact += word;
  }
  return { words, compact, wordStarts, runStarts, shown };
}

/**
 * Letters it takes before a typed word may match inside a longer word of a shown name. Glued
 * names are common ("Apexraceway", "GRP … SuperSoft") and "soft" has to find the second; below
 * four letters the hits are noise ("rc" in "Circuit", "hot" in "Hole Shot").
 */
const INSIDE_WORD_MIN = 4;

/**
 * Whether one typed word is in a field. It has to start where a word (or a letters/digits
 * switch) starts, so "mad" finds "Madness" but "rc" does not find "Circuit" — unless it is four
 * letters or more and the field is one the driver can see (`INSIDE_WORD_MIN`). A number in it
 * has to be a whole number there: "3" is not in "36", "12" is not in "1/10", and "64" is not
 * "6.4", two numbers that only sit side by side. Words may run on across the field's own
 * spaces, which is how "proline" finds "Pro-Line".
 */
function fieldHasWord(field: WordField, word: string): boolean {
  const { compact, wordStarts, runStarts } = field;
  // Letters only, so no number can be cut or joined, and inside ONE word: across two it is chance
  // ("ride" in "Hybrid Evo"). Hidden fields are glued codes and hosts, where a word inside a word
  // is chance too ("madness" in a "minizmadness" host).
  if (field.shown && word.length >= INSIDE_WORD_MIN && !/\d/.test(word)) {
    if (field.words.some((w) => w.includes(word))) return true;
  }
  const endsInDigit = isDigit(word[word.length - 1]);
  next: for (const start of runStarts) {
    if (!compact.startsWith(word, start)) continue;
    const end = start + word.length;
    // Stopped partway through a number: "d3" in "D32".
    if (endsInDigit && isDigit(compact[end]) && !wordStarts.has(end)) continue;
    // Ran two of the field's numbers together: "64" across "6.4".
    for (let i = start + 1; i < end; i++) {
      if (wordStarts.has(i) && isDigit(compact[i - 1]) && isDigit(compact[i])) continue next;
    }
    return true;
  }
  return false;
}

/**
 * Whether every typed word is in the option, in any order, each in any of its fields — the
 * picker's rule for what it lists (founder call 2026-09-26). No typo tolerance: the old
 * leniency was letting one shared word or number through, which this replaces.
 *
 * `fields` are what the driver sees (name, detail line); `hiddenFields` are searched but never
 * shown (a model code, a LiveRC host), and only match where a word starts.
 *
 * Words typed apart may also be found run together ("off road" in "Offroad", "j concepts" in
 * "JConcepts"), but two typed numbers never join into one: "6 4" is not 64.
 */
export function matchesEveryWord(
  query: string,
  fields: Array<string | null | undefined>,
  hiddenFields: Array<string | null | undefined> = []
): boolean {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const prepare = (list: Array<string | null | undefined>, shown: boolean) =>
    list
      .filter((f): f is string => Boolean(f))
      .map((f) => toWordField(normalizeSearchText(f), shown));
  const prepared = [...prepare(fields, true), ...prepare(hiddenFields, false)];
  const found = (word: string) => prepared.some((f) => fieldHasWord(f, word));
  // covered[i]: typed words i… are all found, some perhaps run together.
  const covered: boolean[] = new Array(words.length + 1).fill(false);
  covered[words.length] = true;
  for (let i = words.length - 1; i >= 0; i--) {
    let joined = "";
    for (let j = i; j < words.length && !covered[i]; j++) {
      const word = words[j]!;
      if (j > i && isDigit(words[j - 1]!.slice(-1)) && isDigit(word[0])) break;
      joined += word;
      covered[i] = covered[j + 1]! && found(joined);
    }
  }
  return covered[0]!;
}

export type SearchableOption = {
  value: string;
  label: string;
  /** Second line under the label — shown, and searched. */
  detail?: string | null;
  /** Searched but never shown: model codes, aliases, a town name already in the label. */
  keywords?: string | null;
  disabled?: boolean;
};

export type OptionSection<T extends SearchableOption = SearchableOption> = {
  key: string;
  /** `null` when the section is the whole list and a heading would be noise. */
  label: string | null;
  /**
   * Coarser grouping for a filter-chip rail, where one chip may cover several sections: the
   * chassis picker heads electric and nitro separately but wants one "1/10 Touring" chip, because
   * a rail with a chip per heading does not fit on a phone. Defaults to this section's own
   * `key`/`label`. Only read when a picker turns `sectionFilter` on.
   */
  filterKey?: string;
  filterLabel?: string;
  options: T[];
};

/**
 * What a picker shows, given what has been typed.
 *
 * Two different jobs, so two different shapes:
 *
 * - **Nothing typed** — the browse view: the caller's sections, in order, with
 *   the good stuff first ("Recently used", "Favourites"). Later sections drop
 *   anything an earlier one already showed, so nothing appears twice.
 * - **Something typed** — the find view. Grouping is dead weight once you know
 *   what you're after, so it collapses to one ranked list of the options that
 *   hold every typed word (`matchesEveryWord`), best match first. Section order
 *   still breaks ties: two options that match equally, and the one you ran last
 *   weekend comes first.
 *
 * Equal scores keep the order the CALLER gave them. That used to be alphabetical
 * by label, which quietly destroyed the one thing a run list is sorted by: typing
 * a teammate's name scores all of their runs identically, so a newest-first list
 * re-sorted itself into "ETS Round 1" before "Testing 16 Aug" — E before T. Every
 * caller has already sorted its options for a reason (runs newest first, tracks
 * by name), and a tie is precisely the case where this has nothing better to say
 * than "leave it as you found it".
 */
export function filterOptionSections<T extends SearchableOption>(
  query: string,
  sections: OptionSection<T>[]
): OptionSection<T>[] {
  const seen = new Set<string>();
  const deduped: OptionSection<T>[] = [];
  for (const section of sections) {
    const options = section.options.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
    if (options.length > 0) deduped.push({ ...section, options });
  }

  const q = query.trim();
  if (!q) {
    // A heading over the only section names nothing the sheet title didn't.
    if (deduped.length === 1) return [{ ...deduped[0]!, label: null }];
    return deduped;
  }

  // One running number across every section, in the order the caller laid them
  // out. It carries the section ordering too — section 0's options all number
  // below section 1's — so it is the whole tiebreak rather than a third one.
  let position = 0;
  const scored = deduped
    .flatMap((section) =>
      section.options.map((option) => {
        const fields = [option.label, option.detail, option.keywords];
        const listed = matchesEveryWord(q, [option.label, option.detail], [option.keywords]);
        return {
          option,
          position: position++,
          // Listed only with every word found; the score just orders them. At least 1, because a
          // match made of word starts alone ("jcon refl") has no whole word for the score to count.
          score: listed ? Math.max(1, scoreSearchMatch(q, fields)) : 0,
        };
      })
    )
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position);

  return scored.length > 0
    ? [{ key: "results", label: null, options: scored.map((m) => m.option) }]
    : [];
}

/** Total rows on screen — drives the "no matches" state and the live-region count. */
export function countOptions<T extends SearchableOption>(sections: OptionSection<T>[]): number {
  return sections.reduce((n, s) => n + s.options.length, 0);
}
