import { calendarYmdInTimeZone } from "@/lib/formatDate";

/** Local-midnight helpers for legacy callers. */
export function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
