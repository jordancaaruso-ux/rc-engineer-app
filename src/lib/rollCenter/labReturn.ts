/**
 * Where the Geometry Lab's back arrow goes (founder pin on `/analysis/roll-center`, 2026-08-19:
 * "Need back button").
 *
 * The Lab had no back control at all, so the fixed mobile pill stayed the JRC mark and the only
 * way out was the dashboard — from a page you usually reach two taps deep, holding a setup you
 * were part-way through reading.
 *
 * It cannot be one fixed destination. The Lab is entered from Tools (the geometry band) *and*
 * from any setup sheet's computed-geometry block, which hands it that sheet's numbers. Sending a
 * driver who opened the Lab from their run's sheet back to `/tools` is a wrong answer wearing a
 * back arrow. So the sender says where it came from, in the URL, exactly as Sessions → run does
 * with its own `?back=` (`src/lib/runs/sessionsReturn.ts`).
 *
 * A param and not `sessionStorage` or `router.back()`: the href has to be real markup on the
 * server render, because the mobile pill adopts it (`MobileBackContext`) and has to work before
 * hydration and on a shared or bookmarked link. `history.back()` guesses; a path is a fact.
 *
 * Tools needs no param — it is the default, because the Lab lives in the Tools dock cell
 * (`navConfig.ts`) and that is where an unattributed arrival belongs.
 */

/** Query param carrying the page to return to from the Lab. */
export const LAB_BACK_PARAM = "back";

/** Where back goes when nobody said — the Lab's own dock cell. */
export const LAB_DEFAULT_BACK = "/tools";

/**
 * Same-origin app paths only — never trust `?back=` to be a URL.
 *
 * A single leading `/` is the whole guarantee: it makes the value a path on this origin, so no
 * value that survives can point off-site. `//evil.example`, `https://…` and `javascript:` are all
 * rejected by that one test, and anything else falls back to Tools. Unlike the Sessions version
 * this does NOT pin one route — the Lab is genuinely reachable from runs, saved setups, compare
 * and Tools, and an allowlist would have to be edited every time a new surface draws geometry.
 */
export function safeLabBackHref(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return LAB_DEFAULT_BACK;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return LAB_DEFAULT_BACK;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return LAB_DEFAULT_BACK;
  // Whitespace and control characters cannot appear in a path we wrote; if they are here,
  // something else did. The class is anchored to the control range on purpose — a literal `-`
  // is ordinary in a path, `/analysis/roll-center` being the obvious one.
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return LAB_DEFAULT_BACK;
  return trimmed;
}

/**
 * The `&back=…` tail for a Lab deep link, or nothing when the caller is Tools (the default) or
 * doesn't know where it is. Always used as a suffix — every Lab link already opens with `?s=`.
 */
export function labBackQuery(back: string | null | undefined): string {
  if (typeof back !== "string" || back.length === 0) return "";
  if (safeLabBackHref(back) !== back) return "";
  if (back === LAB_DEFAULT_BACK) return "";
  return `&${LAB_BACK_PARAM}=${encodeURIComponent(back)}`;
}
