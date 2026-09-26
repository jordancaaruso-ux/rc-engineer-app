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
 * One ping-pong we cause ourselves: a back control that PUSHES its destination (the phone's
 * corner pill over Sessions always does). Misread as a return, the parent's own arrow then walks
 * history back into the page just left, and the driver bounces between the two. So a back
 * control that pushes says so first (`recordPush`).
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

/**
 * Pure: which of `candidates` sits directly under `currentPathname` on the trail (the page the
 * driver opened this one from), or null. For a page with more than one parent: team sessions
 * opens from Analysis and from the team's own page, and back should return to the one the driver
 * used ("takes me to analysis, not back to where I was", founder 2026-09-26).
 *
 * Folds the current page in first, so the answer is the same before and after the tracker has
 * recorded it, and on a history return from a child page (the trail still ends at the child) as
 * much as on a first visit. Exported for tests.
 */
export function trailParentAmong(
  trail: readonly string[],
  currentPathname: string,
  candidates: readonly string[]
): string | null {
  const folded = foldPathname(trail, currentPathname);
  const under = folded.length >= 2 ? folded[folded.length - 2] : null;
  if (under == null) return null;
  return candidates.find((href) => hrefPathname(href) === under) ?? null;
}

/**
 * Pure: fold in a pathname the driver was PUSHED to. Never pops: a link that happens to point at
 * the page underneath is still a push. Exported for tests.
 */
export function pushPathname(trail: readonly string[], pathname: string): string[] {
  if (trail[trail.length - 1] === pathname) return [...trail];
  return [...trail, pathname].slice(-MAX_TRAIL_LENGTH);
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

/** Called by `useReturnParent` (client only, after mount). */
export function returnParentAmong(
  currentPathname: string,
  candidates: readonly string[]
): string | null {
  return trailParentAmong(readTrail(), currentPathname, candidates);
}

/**
 * Called by a back control the moment it PUSHES its destination instead of going back through
 * history. To the pop heuristic, a push to the page underneath looks exactly like a history back,
 * so it pops, and that page's own arrow then walks history straight back into the page the driver
 * just left: the team page's arrow bouncing into team sessions, over and over. Recorded here
 * first, the tracker's fold sees the same pathname again and leaves the trail alone.
 */
export function recordPush(href: string): void {
  const pathname = hrefPathname(href);
  if (!pathname) return;
  try {
    sessionStorage.setItem(RETURN_TRAIL_KEY, JSON.stringify(pushPathname(readTrail(), pathname)));
  } catch {
    // Non-fatal — the trail is only ever an optimisation.
  }
}
