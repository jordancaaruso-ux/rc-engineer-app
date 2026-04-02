/**
 * Shared date formatter so server and client render identical strings.
 * Uses fixed locale and options to avoid hydration mismatch.
 */
const LOCALE = "en-GB";
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** Fixed locale for run timestamps (history table, pickers, setup sheets). */
export const RUN_DATETIME_LOCALE = "en-AU";

const RUN_TABLE_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

const RUN_WEEKDAY_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** Compact calendar date for run list labels (matches run picker / scan lines). */
const RUN_PICKER_SCAN_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const APP_TIMESTAMP_OPTIONS_UTC: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
};

/**
 * Deterministic, hydration-safe timestamp string.
 * Always UTC, always `en-GB`, always 24h, always includes seconds.
 *
 * Example: `27/03/2026, 09:27:43`
 */
export function formatAppTimestampUtc(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, APP_TIMESTAMP_OPTIONS_UTC).format(dt);
}

/**
 * Compact date+time for run history rows and detail (SSR-safe: fixed locale + options).
 */
export function formatRunCreatedAtDateTime(d: string | Date): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, RUN_TABLE_DATETIME_OPTIONS).format(dt);
}

/**
 * Date with weekday for printable/setup sheet headers.
 */
export function formatRunCreatedAtDateWeekday(d: string | Date): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, RUN_WEEKDAY_DATE_OPTIONS).format(dt);
}

export function formatRunPickerScanDate(d: string | Date): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, RUN_PICKER_SCAN_DATE_OPTIONS).format(dt);
}

export function formatEventDate(d: string | Date): string {
  return new Date(d).toLocaleDateString(LOCALE, DATE_OPTIONS);
}

export function formatGroupDate(d: string | Date): string {
  return new Date(d).toLocaleDateString(LOCALE, DATE_OPTIONS);
}

const MS_PER_DAY = 86400000;

/**
 * Relative timing for event dropdown: "in 5 days", "starts today", "day 2 of event", "ended 3 days ago".
 * Uses local midnight for today and event start/end dates.
 */
export function formatEventRelativeLabel(ev: {
  startDate: string | Date;
  endDate: string | Date;
}): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(ev.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(ev.endDate);
  end.setHours(0, 0, 0, 0);
  const now = today.getTime();
  const startT = start.getTime();
  const endT = end.getTime();

  if (endT < now) {
    const daysAgo = Math.floor((now - endT) / MS_PER_DAY);
    if (daysAgo === 0) return "ended";
    if (daysAgo === 1) return "ended 1 day ago";
    return `ended ${daysAgo} days ago`;
  }
  if (startT > now) {
    const days = Math.ceil((startT - now) / MS_PER_DAY);
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  }
  if (startT === now) return "starts today";
  const dayNum = Math.floor((now - startT) / MS_PER_DAY) + 1;
  return dayNum === 1 ? "day 1 of event" : `day ${dayNum} of event`;
}
