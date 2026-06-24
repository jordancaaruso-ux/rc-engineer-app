import { eventDateToYmd } from "@/lib/eventDateParse";

export type EventWithDates = {
  startDate: string | Date;
  endDate: string | Date;
};

/** Local calendar YYYY-MM-DD for "today" in the browser / Node local timezone. */
export function localTodayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Split events for pickers and lists.
 * Upcoming = end date on or after today (includes multi-day meetings still in progress
 * and planned future meetings). Event dates use UTC calendar days from storage.
 */
export function splitEventsForPicker<T extends EventWithDates>(
  events: T[],
  todayYmd = localTodayYmd()
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const ev of events) {
    const endYmd = eventDateToYmd(ev.endDate);
    if (endYmd >= todayYmd) upcoming.push(ev);
    else past.push(ev);
  }
  upcoming.sort((a, b) =>
    eventDateToYmd(a.startDate).localeCompare(eventDateToYmd(b.startDate))
  );
  past.sort((a, b) =>
    eventDateToYmd(b.startDate).localeCompare(eventDateToYmd(a.startDate))
  );
  return { upcoming, past };
}
