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
 * ============================== PUSH OR HISTORY BACK? ========================================
 *
 * A route change is either a push (a link, a pushing back control) or a move through history
 * (back / forward: the browser's buttons, a swipe, `router.back()`). Only the second pops the
 * trail, which is what makes chains work — Analysis → teammates list → run, then two
 * history-backs, each restoring scroll. `ReturnTrailTracker` hears the difference from the
 * browser: history moves fire `popstate` (`noteTraversal`), and a page loaded fresh by
 * back/forward says so in its navigation entry.
 *
 * It used to GUESS instead: any change to the entry under the top counted as going back. A link
 * that happens to point two pages back then erased the page in between. Team page → Team
 * sessions → Analysis → a teammate of that team (Team sessions again, by a link) read as
 * stepping back to Team sessions, Analysis vanished from the trail, and the corner back took the
 * driver to the team page instead of Analysis (review, 2026-09-26). Nothing here can strand a
 * driver either way — `PageBackLink` renders the real href for new tabs, crawlers, and every
 * case the trail doesn't recognise.
 *
 * A back control that PUSHES its destination (the phone's corner pill over Sessions always does)
 * still says so first (`recordPush`): it records the push before the destination's own back
 * control asks the trail, and it asks for the driver's place back (below).
 *
 * ============================== A PUSHED RETURN KEEPS THE PLACE TOO ==========================
 *
 * History back puts the driver where they were on the page; a push lands at the top. The Sessions
 * pill pushes, so "Analysis, scroll to a teammate, open them, back" came back to the top of
 * Analysis: the 08-31 ask, come undone (founder, 2026-09-26). So `ReturnTrailTracker` notes the
 * driver's place on every tap (`rememberScroll`), and a back control that pushes to a page the
 * driver came through asks for that place back (`recordPush` → `takeReturnScroll`).
 *
 * `sessionStorage`, not memory: it survives the PWA being backgrounded and the page reloading,
 * dies with the tab (a trail from last week is worthless), and is already the store the sessions
 * token uses. Every read/write is try/caught — storage can be absent or full, and the trail is
 * only ever an optimisation.
 */

export const RETURN_TRAIL_KEY = "rc:return-trail";
/** `{ pathname: scrollY }`, the driver's place on each page at their last tap there. */
export const RETURN_SCROLL_KEY = "rc:return-scroll";
/** The pathname a back control has just pushed to, whose place should be put back on arrival. */
export const RETURN_SCROLL_PENDING_KEY = "rc:return-scroll-pending";

/** Plenty for a session of tapping around; keeps the JSON blob trivial. */
const MAX_TRAIL_LENGTH = 40;
const MAX_SCROLL_ENTRIES = 40;

/**
 * Pure: fold the next visited pathname into the trail. `traversal`: the driver moved through
 * history (back / forward) rather than being pushed to a page. Exported for tests.
 */
export function foldPathname(
  trail: readonly string[],
  pathname: string,
  traversal = false
): string[] {
  const last = trail[trail.length - 1];
  // Same pathname again — a query-only change (`?openGroup=`, filters) or a replace.
  // Not a move between pages, so not a trail entry.
  if (last === pathname) return [...trail];
  if (traversal) {
    // History back to a page on the trail: pop to it — one step, or several at once from the
    // browser's long-press menu. Not on the trail (forward again, or past where it starts): a
    // new top, like a push.
    const at = trail.lastIndexOf(pathname);
    if (at >= 0) return trail.slice(0, at + 1);
  }
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
 * recorded it, and on a history return from a child page (the trail still ends at the child,
 * `traversal`) as much as on a first visit. Exported for tests.
 */
export function trailParentAmong(
  trail: readonly string[],
  currentPathname: string,
  candidates: readonly string[],
  traversal = false
): string | null {
  const folded = foldPathname(trail, currentPathname, traversal);
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

/**
 * Pure: is a push from `currentPathname` to `targetPathname` a return, to a page the driver came
 * through on the way here? Then it should put them back where they were on it. Any depth, not
 * just the page directly underneath: a one-team driver's back from the team page goes to
 * Settings, two steps down past the Teams list that skipped itself. Exported for tests.
 */
export function pushReturnsTo(
  trail: readonly string[],
  currentPathname: string,
  targetPathname: string
): boolean {
  if (targetPathname === currentPathname) return false;
  return foldPathname(trail, currentPathname).slice(0, -1).includes(targetPathname);
}

/** Pure: the scroll map with `pathname` at `y`, newest last, capped. Exported for tests. */
export function withScroll(
  map: Readonly<Record<string, number>>,
  pathname: string,
  y: number
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) if (key !== pathname) next[key] = value;
  next[pathname] = Math.max(0, Math.round(y));
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SCROLL_ENTRIES))) delete next[key];
  return next;
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

/**
 * The page a move through history (back / forward) has just landed on, noted by the tracker's
 * `popstate` listener before the route change reaches any effect. Memory, not storage: it only
 * ever answers for the route change in flight.
 */
let traversalTo: { pathname: string; at: number } | null = null;
/** A history move whose page never got recorded (a hash-only change) must not colour a later push. */
const TRAVERSAL_WINDOW_MS = 10_000;

/** Called by `ReturnTrailTracker` on `popstate`, and on a page the browser loaded by back/forward. */
export function noteTraversal(pathname: string): void {
  traversalTo = { pathname, at: Date.now() };
}

function arrivedByTraversal(pathname: string): boolean {
  return (
    traversalTo != null &&
    traversalTo.pathname === pathname &&
    Date.now() - traversalTo.at < TRAVERSAL_WINDOW_MS
  );
}

/** Called by `ReturnTrailTracker` on every route change. */
export function recordPathname(pathname: string): void {
  const traversal = arrivedByTraversal(pathname);
  traversalTo = null;
  try {
    sessionStorage.setItem(
      RETURN_TRAIL_KEY,
      JSON.stringify(foldPathname(readTrail(), pathname, traversal))
    );
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
  return trailParentAmong(
    readTrail(),
    currentPathname,
    candidates,
    arrivedByTraversal(currentPathname)
  );
}

/**
 * Called by a back control the moment it PUSHES its destination instead of going back through
 * history. Recorded here first, the destination's own back control reads a trail that already
 * holds the push (its effects can run before the tracker's), and the tracker's fold then sees the
 * same pathname again and leaves the trail alone. Without it, the team page's arrow once walked
 * history straight back into team sessions, over and over.
 */
export function recordPush(href: string): void {
  const pathname = hrefPathname(href);
  if (!pathname) return;
  try {
    const trail = readTrail();
    // A push back to a page the driver came through: put them back where they were on it, as
    // history back would have (`takeReturnScroll`, on arrival).
    if (pushReturnsTo(trail, window.location.pathname, pathname)) {
      sessionStorage.setItem(RETURN_SCROLL_PENDING_KEY, pathname);
    }
    sessionStorage.setItem(RETURN_TRAIL_KEY, JSON.stringify(pushPathname(trail, pathname)));
  } catch {
    // Non-fatal — the trail is only ever an optimisation.
  }
}

function readScrollMap(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(RETURN_SCROLL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number")
    );
  } catch {
    return {};
  }
}

/** Called by `ReturnTrailTracker` on every tap: the driver's place on the page they may leave. */
export function rememberScroll(pathname: string, y: number): void {
  try {
    sessionStorage.setItem(RETURN_SCROLL_KEY, JSON.stringify(withScroll(readScrollMap(), pathname, y)));
  } catch {
    // Non-fatal — the trail is only ever an optimisation.
  }
}

/**
 * Called by `ReturnTrailTracker` on arrival: the place to put the driver back at, when a back
 * control has just pushed them to a page they came through (`recordPush`). Consumed either way:
 * a pending restore is only ever for the very next page.
 */
export function takeReturnScroll(pathname: string): number | null {
  try {
    const pending = sessionStorage.getItem(RETURN_SCROLL_PENDING_KEY);
    if (pending == null) return null;
    sessionStorage.removeItem(RETURN_SCROLL_PENDING_KEY);
    if (pending !== pathname) return null;
    const y = readScrollMap()[pathname];
    return typeof y === "number" && y > 0 ? y : null;
  } catch {
    return null;
  }
}
