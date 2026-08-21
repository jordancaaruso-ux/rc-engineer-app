/**
 * Where the back arrow on a shared catalog page goes.
 *
 * `/tires` and `/additives` used to have exactly one way in — the Settings list — so their back
 * arrow could hard-code `/settings`. The Paddock consumables bands (2026-08-19) gave them a
 * second, and a driver who opened the tyre catalog from Paddock and pressed back landed in
 * Settings, which is the wrong room and one they never asked for.
 *
 * Same `?back=` shape the run page already uses (`safeSessionsBackHref`), and validated the same
 * way — never trust a path out of a query string. This one is stricter than that one because it
 * has no filters to preserve: an exact-match allowlist rather than a prefix test, so there is
 * nothing to reason about. Anything unrecognised falls back to Settings, which is where these
 * pages are filed and therefore always a defensible answer.
 */

export const CATALOG_BACK_PARAM = "back";

const CATALOG_HOME = "/settings";
const ALLOWED_RETURNS = new Set([CATALOG_HOME, "/paddock"]);

export function safeCatalogBackHref(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return CATALOG_HOME;
  const trimmed = value.trim();
  return ALLOWED_RETURNS.has(trimmed) ? trimmed : CATALOG_HOME;
}

/** A link to a catalog page that will send the driver back to Paddock. */
export function catalogHrefFromPaddock(path: string): string {
  return `${path}?${CATALOG_BACK_PARAM}=${encodeURIComponent("/paddock")}`;
}
