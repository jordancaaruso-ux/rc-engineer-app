/**
 * "search sa state titles" → the driver's SA State Titles 2026 meeting, attached as the
 * Engineer's filter without them opening the picker (founder call 2026-09-14: "if I say
 * 'search sa state titles' can it not just look for that by itself? … it needs to be able to
 * interpret errors a bit, not just exact matches").
 *
 * This is plain matching against the names of the driver's OWN events and tracks — no model,
 * no tools, nothing inferred beyond a name the driver typed. The bar switches to show what was
 * attached, so a wrong match is visible and one tap away from cleared. Typos are forgiven by
 * edit distance (one slip on a short word, two on a long one); "the nationals last year" is
 * not a name and matches nothing.
 */

export type NamedScopeCandidate = {
  id: string;
  name: string;
  /** Events only: start date, YYYY-MM-DD — breaks ties toward the most recent meeting. */
  from?: string | null;
};

export type NamedScopeMatch = { kind: "event" | "track"; id: string; name: string };

const STOP = new Set(["the", "of", "at", "and", "a", "an", "in", "on", "for", "to"]);
const YEAR = /^(19|20)\d\d$/;

export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Optimal-string-alignment distance: insert, delete, substitute, or swap two neighbours. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** How many slips a word of this length may carry and still count. Four letters: none. */
function allowedSlips(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

function tokenMatches(want: string, have: string): boolean {
  if (want === have) return true;
  if (want.length < 5 || have.length < 4) return false;
  return editDistance(want, have) <= allowedSlips(want.length);
}

type Scored = NamedScopeMatch & { score: number; required: number; from: string | null };

function scoreCandidate(
  kind: "event" | "track",
  c: NamedScopeCandidate,
  msg: string[],
  msgYears: string[]
): Scored | null {
  const tokens = nameTokens(c.name);
  if (tokens.length === 0) return null;
  const years = tokens.filter((t) => YEAR.test(t));
  let required = tokens.filter((t) => !YEAR.test(t) && !STOP.has(t));
  if (required.length === 0) required = tokens.filter((t) => !STOP.has(t));
  if (required.length === 0) return null;

  // A lone short word is too easy to hit by accident: "Bayside" can stand alone, "SA" cannot.
  if (required.length === 1 && required[0].length < 4) return null;

  let matched = 0;
  for (const t of required) {
    if (msg.some((m) => tokenMatches(t, m))) matched++;
  }
  const needed = required.length <= 2 ? required.length : required.length - 1;
  if (matched < needed || matched === 0) return null;

  let score = matched / required.length;
  // A year in the message picks that year's meeting: the year in the name, or failing that the
  // year the meeting was held. A disagreeing year is a different meeting.
  const candidateYears = years.length > 0 ? years : c.from ? [c.from.slice(0, 4)] : [];
  if (msgYears.length > 0 && candidateYears.length > 0) {
    if (candidateYears.some((y) => msgYears.includes(y))) score += 0.1;
    else score -= 0.5;
  }
  if (score <= 0) return null;
  return { kind, id: c.id, name: c.name, score, required: required.length, from: c.from ?? null };
}

/**
 * A driver named in the message, from the names on the timing sheets (rivals.ts). The surname
 * (the last word of the name) must be there, typos forgiven; the first name helps break a tie
 * between two drivers who share one. "tim hilyear", "hilyear", "hillyear" all find Tim
 * Hilyear; a surname shared by two drivers with neither first name given finds no one.
 */
export function matchDriverName(message: string, names: readonly string[]): string | null {
  const msg = nameTokens(message);
  if (msg.length === 0) return null;
  const scored: Array<{ name: string; matched: number; surname: string }> = [];
  for (const name of names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const surname = tokens[tokens.length - 1];
    if (surname.length < 4) continue;
    if (!msg.some((m) => tokenMatches(surname, m))) continue;
    const matched = tokens.filter((t) => msg.some((m) => tokenMatches(t, m))).length;
    scored.push({ name, matched, surname });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.matched - a.matched);
  const best = scored[0];
  const rival = scored[1];
  if (rival && rival.matched === best.matched && rival.name !== best.name) return null;
  return best.name;
}

/**
 * The best-matching event or track named in the message, or null. Events are preferred over
 * tracks at equal score (a meeting is the more specific thing), longer names over shorter,
 * and the most recent meeting wins a tie between yearly repeats.
 */
export function matchNamedScope(
  message: string,
  names: { events: NamedScopeCandidate[]; tracks: NamedScopeCandidate[] }
): NamedScopeMatch | null {
  const msg = nameTokens(message);
  if (msg.length === 0) return null;
  const msgYears = msg.filter((t) => YEAR.test(t));
  const scored: Scored[] = [];
  for (const e of names.events) {
    const s = scoreCandidate("event", e, msg, msgYears);
    if (s) scored.push(s);
  }
  for (const t of names.tracks) {
    const s = scoreCandidate("track", t, msg, msgYears);
    if (s) scored.push(s);
  }
  if (scored.length === 0) return null;
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1) ||
      b.required - a.required ||
      (b.from ?? "").localeCompare(a.from ?? "")
  );
  const best = scored[0];
  // "state titles" fits three different meetings equally: that is not a name, so nothing is
  // attached. Two entries of the SAME name (a yearly meeting) are a tie the sort has settled.
  const rival = scored[1];
  if (rival && rival.score === best.score && rival.kind === best.kind && rival.name !== best.name) return null;
  return { kind: best.kind, id: best.id, name: best.name };
}
