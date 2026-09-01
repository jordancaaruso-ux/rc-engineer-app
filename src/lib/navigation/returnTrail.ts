/**
 * The return trail — app-wide scroll-preserving "back" (founder ask 2026-08-31:
 * "I'm in analysis, go down to the teammates, select one, go back and it goes to
 * the top of the screen").
 *
 * ============================== WHY A TRAIL AND NOT MORE TOKENS ==============================
 *
 * A back arrow that is a plain `<Link>` is a FRESH visit: the browser has no idea the driver has
 * been there, so it starts them at the top. Real history navigation (`router.back()`) restores
 * their scroll position for free — but it is only correct when the page the arrow points at is
 * the page the driver actually came from. `SESSIONS_RETURN_KEY` answers that for exactly one
 * door pair by stamping a token on the way in; wiring a stamp onto every door in the app would
 * touch dozens of origin links and still miss the next one built.
 *
 * So instead ONE component (`ReturnTrailTracker`, in the root layout) records every pathname the
 * driver walks through, and `PageBackLink` asks the trail: "did they come from the page my href
 * points at?" Yes → history back, scroll restored. No — shared link, cold launch, arrived from
 * somewhere else — → the plain link it always was, so the arrow always has somewhere to go.
 *
 * ============================== THE POP HEURISTIC, AND WHAT IT ACCEPTS =======================
 *
 * The browser doesn't tell us whether a route change was a push or a back/forward, so the trail
 * guesses: a change to the entry UNDER the top is treated as going back and pops the trail. That
 * makes chains work — Analysis → teammates list → run, then two history-backs, each restoring
 * scroll. The false positive is ping-ponging A→B→A via links, which the trail misreads as a
 * return. The consequence is bounded and mild either way: the arrow either falls back to a plain
 * link (today's behaviour everywhere) or walks history to where the driver genuinely was one
 * step ago. Nothing here can strand them — `PageBackLink` renders the real href for new tabs,
 * crawlers, and every case the trail doesn't recognise.
 *
 * `sessionStorage`, not memory: it survives the PWA being backgrounded and the page reloading,
 * dies with the tab (a trail from last week is worthless), and is already the store the sessions
 * token uses. Every read/write is try/caught — storage can be absent or full, and the trail is
 * only ever an optimisation.
 */

export const RETURN_TRAIL_KEY = "rc:return-trail";

/** Plenty for a session of tapping around; keeps the JSON blob trivial. */
const MAX_TRAIL_LENGTH = 40;

/** Pure: fold the next visited pathname into the trail. Exported for tests. */
export function foldPathname(trail: readonly string[], pathname: string): string[] {
  const last = trail[trail.length - 1];
  // Same pathname again — a query-only change (`?openGroup=`, filters) or a replace.
  // Not a move between pages, so not a trail entry.
  if (last === pathname) return [...trail];
  // Looks like history back (or the ping-pong false positive — see above): pop.
  if (trail.length >= 2 && trail[trail.length - 2] === pathname) return trail.slice(0, -1);
  return [...trail, pathname].slice(-MAX_TRAIL_LENGTH);
}

/**
 * Pure: does the trail say the driver reached `currentPathname` from `targetPathname`?
 *
 * Answered against BOTH possible trail states, because React runs a page's effects bottom-up:
 * a deep `PageBackLink` asks before the layout-level tracker has recorded the new page, when
 * the trail still ENDS at the referrer — and re-asks after, when the trail ends at the current
 * page. Depending on that ordering instead of handling it is how this would break silently on
 * the next React version.
 */
export function trailSaysCameFrom(
  trail: readonly string[],
  targetPathname: string,
  currentPathname: string
): boolean {
  const last = trail[trail.length - 1];
  if (last === currentPathname) return trail[trail.length - 2] === targetPathname;
  return last === targetPathname;
}

/** Pathname of a same-app href string ("/cars?back=/paddock" → "/cars"), or null. */
export function hrefPathname(href: string): string | null {
  try {
    return new URL(href, "http://rc.invalid").pathname;
  } catch {
    return null;
  }
}

function readTrail(): string[] {
  try {
    const raw = sessionStorage.getItem(RETURN_TRAIL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Called by `ReturnTrailTracker` on every route change. */
export function recordPathname(pathname: string): void {
  try {
    sessionStorage.setItem(RETURN_TRAIL_KEY, JSON.stringify(foldPathname(readTrail(), pathname)));
  } catch {
    // Non-fatal — the trail is only ever an optimisation.
  }
}

/** Called by `PageBackLink` (client only, after mount). */
export function cameFromPathname(targetPathname: string, currentPathname: string): boolean {
  return trailSaysCameFrom(readTrail(), targetPathname, currentPathname);
}
