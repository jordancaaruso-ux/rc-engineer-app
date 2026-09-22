/**
 * The Engineer's fourth subject — the FILTER: a meeting, or a track / a car type / a span of
 * dates — instead of one run (founder call 2026-09-14: "ask the Engineer to look at lap times
 * from a certain track or set of dates"; renamed from "range" to "filter" the same day).
 *
 * Client-safe: the subject bar reads and writes this in the URL, the chat route reads it off
 * the request body, and driverHistory.ts turns it into the runs the Engineer sees. The filter
 * is explicit on purpose — the Engineer cannot query the database (its one tool reads LiveRC, not
 * the log — tools.ts), so the
 * driver names the runs (in the picker, or by naming a meeting in the question — nameMatch.ts)
 * and the app attaches exactly that.
 */

export type EngineerRangeScope = {
  /** A meeting: its own runs, plus runs at its track on its declared days. */
  eventId: string | null;
  trackId: string | null;
  /** One car; the server widens it to every car of the same type, as the day block does. */
  carId: string | null;
  /** Local calendar dates, YYYY-MM-DD, inclusive. Null = open at that end. */
  from: string | null;
  to: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function cleanId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

function cleanYmd(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return YMD.test(s) ? s : null;
}

/**
 * Validate an untrusted scope (request body or URL). Returns null when it is not a scope at
 * all; a scope with every field null is legitimate — "all my runs".
 */
export function parseRangeScope(raw: unknown): EngineerRangeScope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  let from = cleanYmd(o.from);
  let to = cleanYmd(o.to);
  if (from && to && from > to) [from, to] = [to, from];
  return { eventId: cleanId(o.eventId), trackId: cleanId(o.trackId), carId: cleanId(o.carId), from, to };
}

export const EMPTY_RANGE_SCOPE: EngineerRangeScope = { eventId: null, trackId: null, carId: null, from: null, to: null };

export function eventScope(eventId: string): EngineerRangeScope {
  return { ...EMPTY_RANGE_SCOPE, eventId };
}

export function trackScope(trackId: string): EngineerRangeScope {
  return { ...EMPTY_RANGE_SCOPE, trackId };
}

/** URL form: `?mode=filter&event=…&track=…&car=…&from=…&to=…`. */
export const RANGE_URL_KEYS = ["event", "track", "car", "from", "to"] as const;
export const RANGE_URL_MODE = "filter";

export function rangeScopeFromSearchParams(sp: URLSearchParams): EngineerRangeScope | null {
  if (sp.get("mode") !== RANGE_URL_MODE) return null;
  return parseRangeScope({
    eventId: sp.get("event"),
    trackId: sp.get("track"),
    carId: sp.get("car"),
    from: sp.get("from"),
    to: sp.get("to"),
  });
}

export function writeRangeScopeToSearchParams(sp: URLSearchParams, scope: EngineerRangeScope): void {
  sp.set("mode", RANGE_URL_MODE);
  if (scope.eventId) sp.set("event", scope.eventId);
  if (scope.trackId) sp.set("track", scope.trackId);
  if (scope.carId) sp.set("car", scope.carId);
  if (scope.from) sp.set("from", scope.from);
  if (scope.to) sp.set("to", scope.to);
}

export function rangeScopeToQuery(scope: EngineerRangeScope): string {
  const sp = new URLSearchParams();
  if (scope.eventId) sp.set("eventId", scope.eventId);
  if (scope.trackId) sp.set("trackId", scope.trackId);
  if (scope.carId) sp.set("carId", scope.carId);
  if (scope.from) sp.set("from", scope.from);
  if (scope.to) sp.set("to", scope.to);
  return sp.toString();
}

export function sameRangeScope(a: EngineerRangeScope | null, b: EngineerRangeScope | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.eventId === b.eventId && a.trackId === b.trackId && a.carId === b.carId && a.from === b.from && a.to === b.to
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Jun" or "1 Jun 2025" — the year only when it is not this year. */
function shortDate(ymd: string, withYear: boolean): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/** "1 Jun – 14 Sep", "from 1 Jun", "to 14 Sep", or "all dates". */
export function describeRangeDates(scope: Pick<EngineerRangeScope, "from" | "to">, todayYear?: number): string {
  const year = todayYear ?? new Date().getFullYear();
  const withYear = (ymd: string) => Number(ymd.slice(0, 4)) !== year;
  if (scope.from && scope.to) {
    if (scope.from === scope.to) return shortDate(scope.from, withYear(scope.from));
    return `${shortDate(scope.from, withYear(scope.from))} – ${shortDate(scope.to, withYear(scope.to))}`;
  }
  if (scope.from) return `from ${shortDate(scope.from, withYear(scope.from))}`;
  if (scope.to) return `to ${shortDate(scope.to, withYear(scope.to))}`;
  return "all dates";
}

/**
 * The subject bar's label: "SA State Titles 2026 · 20 runs" for a meeting, else
 * "Keilor · 1 Jun – 14 Sep · 43 runs". Names come from the options the client already
 * holds; an id the options don't know prints as its kind.
 */
export function describeRangeScope(
  scope: EngineerRangeScope,
  names: {
    events?: Array<{ id: string; name: string }>;
    tracks: Array<{ id: string; name: string }>;
    cars: Array<{ id: string; name: string }>;
    count?: number | null;
  },
  todayYear?: number
): string {
  const parts: string[] = [];
  if (scope.eventId) {
    parts.push(names.events?.find((e) => e.id === scope.eventId)?.name ?? "One meeting");
  } else {
    parts.push(
      scope.trackId ? names.tracks.find((t) => t.id === scope.trackId)?.name ?? "One track" : "All tracks"
    );
  }
  const car = scope.carId ? names.cars.find((c) => c.id === scope.carId)?.name ?? null : null;
  if (car) parts.push(car);
  if (!scope.eventId) parts.push(describeRangeDates(scope, todayYear));
  if (typeof names.count === "number") parts.push(`${names.count} run${names.count === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
