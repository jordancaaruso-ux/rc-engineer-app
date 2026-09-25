/**
 * `SAT 8 AUG 2026` — the date stamp every shared picture carries, in the viewer's zone like every
 * other date the app prints. Formatted by the routes, where the zone is known; the renderers
 * never touch time zones.
 */
export function formatShareDateStamp(instant: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  })
    .format(instant)
    .replace(/,/g, "")
    .toUpperCase();
}
