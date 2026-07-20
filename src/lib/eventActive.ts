import { calendarYmdInTimeZone } from "@/lib/formatDate";

/** Local-midnight helpers for legacy callers. */
export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Offset of `timeZone` from UTC at instant `at`, in milliseconds (AEST → +10h).
 * Derived via Intl so DST is respected without a tz database dependency.
 */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

/**
 * Reinterpret a "wall clock stored as-if-UTC" instant as the real instant in
 * `timeZone`. Timing imports (LiveRC/MyRCM) give track wall clock with no zone
 * and the parsers store it with the UTC fields holding the wall-clock digits;
 * this returns the instant whose wall clock in `timeZone` shows those digits
 * (e.g. fake `16:36Z` + Australia/Sydney → real `06:36Z`). Two offset passes
 * keep DST-transition edges exact, same as {@link startOfDayInTimeZone}.
 */
export function wallClockAsUtcToInstant(wallClockAsUtc: Date, timeZone: string): Date {
  const wallMs = wallClockAsUtc.getTime();
  let instant = wallMs - zoneOffsetMs(timeZone, wallClockAsUtc);
  instant = wallMs - zoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/**
 * UTC instant of midnight starting `now`'s calendar day in an IANA `timeZone`.
 * Servers run in UTC (Vercel), so `setHours(0,0,0,0)` puts the day boundary at
 * 10am for an AEST user — day-scoped queries must anchor to the USER's midnight.
 */
export function startOfDayInTimeZone(timeZone: string, now = new Date()): Date {
  const [y, m, d] = calendarYmdInTimeZone(now, timeZone).split("-").map(Number);
  const dayUtc = Date.UTC(y, m - 1, d);
  // Guess the instant assuming the offset at UTC-midnight, then re-derive the
  // offset at the guessed instant — the second pass lands exactly on local
  // midnight even when a DST transition sits between the two.
  let instant = dayUtc - zoneOffsetMs(timeZone, new Date(dayUtc));
  instant = dayUtc - zoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

/**
 * [start, end) UTC bounds of `now`'s calendar day in an IANA `timeZone`.
 * `end` is the start of the NEXT local day (so 23/25-hour DST days stay exact).
 */
export function todayBoundsInTimeZone(
  timeZone: string,
  now = new Date()
): { start: Date; end: Date } {
  const start = startOfDayInTimeZone(timeZone, now);
  // 30h past local midnight is always inside the next local day (even a 25h day).
  const end = startOfDayInTimeZone(timeZone, new Date(start.getTime() + 30 * 3_600_000));
  return { start, end };
}

export type EventCalendarStatus = "active" | "upcoming" | "past";
export type FeaturedEventStatus = "active" | "next" | "last";

export function todayYmdInTimeZone(timeZone: string, now = new Date()): string {
  return calendarYmdInTimeZone(now, timeZone);
}

/** Event calendar range includes today in the given IANA timezone. */
export function eventCalendarStatus(
  ev: { startDate: Date | string; endDate: Date | string },
  timeZone: string,
  todayYmd?: string
): EventCalendarStatus {
  const today = todayYmd ?? todayYmdInTimeZone(timeZone);
  const start = calendarYmdInTimeZone(ev.startDate, timeZone);
  const end = calendarYmdInTimeZone(ev.endDate, timeZone);
  if (start <= today && today <= end) return "active";
  if (start > today) return "upcoming";
  return "past";
}

export function eventIsActiveOnCalendarDay(
  ev: { startDate: Date | string; endDate: Date | string },
  timeZone: string,
  todayYmd?: string
): boolean {
  return eventCalendarStatus(ev, timeZone, todayYmd) === "active";
}

/** @deprecated Prefer {@link eventIsActiveOnCalendarDay} with explicit timezone. */
export function eventIsActiveOnLocalToday(ev: { startDate: Date; endDate: Date }): boolean {
  const timeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";
  return eventIsActiveOnCalendarDay(ev, timeZone);
}

export type EventForFeaturedPick = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  runCount: number;
};

export function pickFeaturedEvent<T extends EventForFeaturedPick>(
  events: T[],
  timeZone: string,
  now = new Date()
): (T & { featuredStatus: FeaturedEventStatus }) | null {
  const today = todayYmdInTimeZone(timeZone, now);

  const withStatus = events.map((event) => ({
    ...event,
    calendarStatus: eventCalendarStatus(event, timeZone, today),
  }));

  const active = withStatus.filter((event) => event.calendarStatus === "active");
  if (active.length > 0) {
    const picked = active.reduce((a, b) =>
      new Date(a.startDate).getTime() >= new Date(b.startDate).getTime() ? a : b
    );
    return { ...picked, featuredStatus: "active" };
  }

  const upcoming = withStatus
    .filter((event) => event.calendarStatus === "upcoming")
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  if (upcoming.length > 0) {
    return { ...upcoming[0], featuredStatus: "next" };
  }

  const pastWithRuns = withStatus
    .filter((event) => event.calendarStatus === "past" && event.runCount > 0)
    .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  if (pastWithRuns.length > 0) {
    return { ...pastWithRuns[0], featuredStatus: "last" };
  }

  return null;
}
