/**
 * A whole count with a comma every three digits, "1,070", printed the same by the server and by
 * every browser.
 *
 * `toLocaleString()` with no locale follows the device: a Dutch or German browser printed "1.070"
 * where the server had printed "1,070", and React threw the page's server render away over the
 * difference (hydration error on the Tracks page, test drive 2026-09-26). Built by hand rather than
 * asked of `Intl`, so no locale data on either side can change it.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
