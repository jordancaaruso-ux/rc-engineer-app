/**
 * Calendar YYYY-MM-DD for an instant in a specific IANA timezone (e.g. Australia/Sydney).
 * Used so "today" / date ranges match the user's local day, not UTC midnight.
 */
export function formatLocalCalendarDate(d: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !day) return d.toISOString().slice(0, 10);
    return `${y}-${m}-${day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function localDateStringCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
