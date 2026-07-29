/**
 * Return state for the Sessions → run → back round trip (founder ask 2026-07-29:
 * "going back disconnects you from where you were").
 *
 * Opening a run stamps the Sessions URL with `?openGroup=<runId>` and hands the
 * same URL to the run page as `?back=`. Sessions then re-opens that run's session
 * group, scrolls to the row and marks it, so back lands you where you left rather
 * than on a cold, fully collapsed list.
 *
 * Two params, deliberately distinct:
 * - `openGroup` — expands the containing group *in place*. Safe as a back target.
 * - `focusRun`  — the legacy deep link, which now redirects to the run view. It
 *   must keep redirecting (old push notifications and bookmarks carry it), which
 *   is exactly why the back trip needs a param of its own.
 */

/** Query param that re-opens a run's session group on Sessions. */
export const OPEN_GROUP_PARAM = "openGroup";

/** Query param carrying the Sessions URL to return to from a run page. */
export const BACK_PARAM = "back";

/**
 * `sessionStorage` key holding the run id we most recently opened *from Sessions*.
 * When it matches the run being viewed, back can use real history navigation
 * (keeps scroll restoration, adds no history entry); otherwise the back control
 * is a plain link, so a shared link or a cold app launch still has somewhere to go.
 */
export const SESSIONS_RETURN_KEY = "rc:sessions-return-run";

/** Same-origin `/runs/history` URLs only — never trust `?back=` to be a full URL. */
export function safeSessionsBackHref(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "/runs/history";
  const trimmed = value.trim();
  // Reject protocol-relative (`//evil.com`) and absolute URLs outright.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/runs/history";
  const path = trimmed.split(/[?#]/, 1)[0];
  if (path !== "/runs/history") return "/runs/history";
  return trimmed;
}
