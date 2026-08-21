import { safeAppPath } from "@/lib/navigation/safeAppPath";

/**
 * Where the setup editor's back arrow goes, and where a run correction lands.
 *
 * ============================== THE DEAD END THIS FIXES ==============================
 *
 * The editor at `/cars/[carId]/setups/[setupId]/edit` is reached from two very
 * different places: the garage, where the car page is the right way out, and a
 * run's setup panel, where it is not. Its back arrow was hard-coded to the car
 * page either way.
 *
 * Worse was the save. Correcting a run mints a NEW snapshot, so the row in the URL
 * stops being that run's record — and the editor followed that reasoning to its
 * literal conclusion by pushing the driver to the *new snapshot's* edit page. A
 * driver who came from a run, corrected it, and pressed the primary button ended
 * up on a second copy of the editor, on a setup id they had never seen, with no
 * route back to the run they were reading (founder call, 2026-08-20).
 *
 * The sender now says where it came from. `?run=` already decides what a save
 * MEANS; `?back=` decides where it ends up, and the two are independent — a run's
 * setup can be opened from the run page, from Sessions, or from a share link.
 *
 * A param and not `router.back()`: the href has to be real markup on the server
 * render because the mobile pill adopts it (`MobileBackContext`), and this app's
 * PWA history is a known fragile spot. `history.back()` guesses; a path is a fact.
 */

/** Query param carrying the page to return to. */
export const SETUP_EDITOR_BACK_PARAM = "back";

/**
 * The validated return path, or the caller's fallback.
 *
 * The fallback is passed in rather than fixed: an unattributed arrival at a car's
 * setup belongs on that car's page, and only the caller knows which car.
 */
export function safeSetupEditorBackHref(
  raw: string | string[] | undefined,
  fallback: string
): string {
  return safeAppPath(raw) ?? fallback;
}

/** The `&back=…` tail for a link into the editor. Empty when there is nothing worth saying. */
export function setupEditorBackQuery(back: string | null | undefined): string {
  const safe = safeAppPath(back);
  if (!safe) return "";
  return `&${SETUP_EDITOR_BACK_PARAM}=${encodeURIComponent(safe)}`;
}
