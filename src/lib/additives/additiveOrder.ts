/**
 * The additives list's order: by name, case aside, the same on the server and in the browser.
 *
 * The database sorted upper case first, so a racer's "canowindra grip mix" sat below every
 * capitalised name until an add or a rename re-sorted the list in the browser, which ignores case,
 * and the rows jumped (test drive, 2026-09-26). One fixed locale, so every browser agrees too.
 */
export function compareAdditiveNames(a: { displayName: string }, b: { displayName: string }): number {
  return a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" });
}
