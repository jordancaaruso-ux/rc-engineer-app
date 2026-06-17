/** Parse YYYY-MM-DD (from date inputs) to UTC noon on that calendar day. */
export function parseEventDateYmd(input: string | Date): Date {
  if (input instanceof Date) {
    if (!Number.isNaN(input.getTime())) return input;
    return new Date();
  }
  const raw = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Format a stored event date as YYYY-MM-DD for `<input type="date">` (UTC calendar day). */
export function eventDateToYmd(d: string | Date): string {
  const date = new Date(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
