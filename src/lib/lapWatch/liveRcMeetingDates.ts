import { parseEventDateYmd } from "@/lib/eventDateParse";

/** Local calendar YYYY-MM-DD (safe for client components). */
export function localTodayYmd(referenceDate: Date = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultEventDatesForLiveRcDetection(referenceDate: Date = new Date()): {
  startDate: Date;
  endDate: Date;
  startYmd: string;
  endYmd: string;
} {
  const ymd = localTodayYmd(referenceDate);
  const startDate = parseEventDateYmd(ymd);
  return { startDate, endDate: startDate, startYmd: ymd, endYmd: ymd };
}
