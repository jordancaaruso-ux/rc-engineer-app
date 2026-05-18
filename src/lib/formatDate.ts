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

/**
 * Wall-clock slice for a run instant. Pass explicit `timeZone` (e.g. from the
 * `rc_tz` cookie via {@link getExplicitTimeZoneForRunFormatting}) so SSR matches
 * the device after the cookie is set; omit `timeZone` only when you intend the
 * runtime default calendar (not recommended for run lists).
 */
export const RUN_DISPLAY_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
};

const RUN_TABLE_DATETIME_OPTIONS = RUN_DISPLAY_DATETIME_OPTIONS;

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
 * Compact date+time for run history rows and detail.
 * Prefer passing `timeZone` (IANA) so server output matches the signed-in device
 * once the `rc_tz` cookie is present.
 */
export function formatRunCreatedAtDateTime(d: string | Date, timeZone?: string | null): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const tz = timeZone?.trim();
  const opts: Intl.DateTimeFormatOptions = {
    ...RUN_TABLE_DATETIME_OPTIONS,
    ...(tz ? { timeZone: tz } : {}),
  };
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, opts).format(dt);
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

/**
 * Date-only label for sessions list rows (no time). Prefer passing `timeZone`
 * (IANA) so SSR matches the signed-in device once `rc_tz` is set.
 */
export function formatRunDateOnly(d: string | Date, timeZone?: string | null): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const tz = timeZone?.trim();
  const opts: Intl.DateTimeFormatOptions = {
    ...RUN_PICKER_SCAN_DATE_OPTIONS,
    ...(tz ? { timeZone: tz } : {}),
  };
  return new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, opts).format(dt);
}

export function formatRunDateCompact(d: string | Date, timeZone?: string | null): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const tz = timeZone?.trim();
  const parts = new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  }).formatToParts(dt);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  const day = get("day");
  const month = get("month");
  const year = get("year");
  return day && month && year ? `${day}/${month}/${year}` : "—";
}

const MS_PER_DAY = 86_400_000;

/**
 * Calendar-day distance between two instants in `timeZone` (IANA), or the
 * runtime default zone when omitted. Non-negative when `a` is on or before `b`'s calendar day.
 */
export function calendarDayDifference(a: Date, b: Date, timeZone?: string | null): number {
  const tz =
    timeZone?.trim() ||
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC");
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const [ya, ma, da] = key(a).split("-").map(Number);
  const [yb, mb, db] = key(b).split("-").map(Number);
  const tA = Date.UTC(ya, ma - 1, da);
  const tB = Date.UTC(yb, mb - 1, db);
  return Math.round((tB - tA) / MS_PER_DAY);
}

export function formatEventDate(d: string | Date): string {
  return new Date(d).toLocaleDateString(LOCALE, DATE_OPTIONS);
}

export function formatGroupDate(d: string | Date): string {
  return new Date(d).toLocaleDateString(LOCALE, DATE_OPTIONS);
}

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
