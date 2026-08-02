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
 * coincidental prefix — and anything with no shared token at all scores by
 * overlap ratio, which is what keeps siblings ("Sweep 32" under "sweep 36")
 * on screen instead of dropping the near-miss you probably meant.
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
 *   what you're after, so it collapses to one ranked list. Section order still
 *   breaks ties: two options that match equally, and the one you ran last
 *   weekend comes first.
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

  const scored = deduped
    .flatMap((section, sectionIndex) =>
      section.options.map((option) => ({
        option,
        sectionIndex,
        score: scoreSearchMatch(q, [option.label, option.detail, option.keywords]),
      }))
    )
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.sectionIndex - b.sectionIndex ||
        a.option.label.localeCompare(b.option.label)
    );

  return scored.length > 0
    ? [{ key: "results", label: null, options: scored.map((m) => m.option) }]
    : [];
}

/** Total rows on screen — drives the "no matches" state and the live-region count. */
export function countOptions<T extends SearchableOption>(sections: OptionSection<T>[]): number {
  return sections.reduce((n, s) => n + s.options.length, 0);
}
