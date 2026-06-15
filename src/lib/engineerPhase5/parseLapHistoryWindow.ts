import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";

export type LapHistoryDateWindow = {
  dateFrom: string;
  dateTo: string;
  label: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Subtract whole calendar months from YYYY-MM-DD (clamp day to month length). */
export function subtractCalendarMonths(ymd: string, months: number): string {
  const [ys, ms, ds] = ymd.split("-");
  let y = Number(ys);
  let m = Number(ms);
  const d = Number(ds);
  m -= months;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

function subtractCalendarDays(ymd: string, days: number): string {
  const [ys, ms, ds] = ymd.split("-");
  const dt = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds)));
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * Parse relative date windows from natural language (no LLM).
 * Returns null when no window is detected — caller may still search all time.
 */
export function parseLapHistoryDateWindow(
  message: string,
  timeZone: string,
  now = new Date()
): LapHistoryDateWindow | null {
  const tz = timeZone.trim() || "UTC";
  const to = formatLocalCalendarDate(now, tz);
  const lower = message.toLowerCase();

  const monthsN = lower.match(/\b(?:last|past)\s+(\d+)\s+months?\b/);
  if (monthsN) {
    const n = Math.min(24, Math.max(1, Number(monthsN[1])));
    return {
      dateFrom: subtractCalendarMonths(to, n),
      dateTo: to,
      label: `the last ${n} month${n === 1 ? "" : "s"}`,
    };
  }

  const weeksN = lower.match(/\b(?:last|past)\s+(\d+)\s+weeks?\b/);
  if (weeksN) {
    const n = Math.min(52, Math.max(1, Number(weeksN[1])));
    return {
      dateFrom: subtractCalendarDays(to, n * 7),
      dateTo: to,
      label: `the last ${n} week${n === 1 ? "" : "s"}`,
    };
  }

  const daysN = lower.match(/\b(?:last|past)\s+(\d+)\s+days?\b/);
  if (daysN) {
    const n = Math.min(366, Math.max(1, Number(daysN[1])));
    return {
      dateFrom: subtractCalendarDays(to, n),
      dateTo: to,
      label: `the last ${n} day${n === 1 ? "" : "s"}`,
    };
  }

  if (/\b(?:last|past)\s+month\b/.test(lower)) {
    return { dateFrom: subtractCalendarMonths(to, 1), dateTo: to, label: "the last month" };
  }
  if (/\b(?:last|past)\s+week\b/.test(lower)) {
    return { dateFrom: subtractCalendarDays(to, 7), dateTo: to, label: "the last week" };
  }
  if (/\b(?:last|past)\s+year\b/.test(lower)) {
    return { dateFrom: subtractCalendarMonths(to, 12), dateTo: to, label: "the last year" };
  }
  if (/\bthis\s+year\b/.test(lower)) {
    const y = to.slice(0, 4);
    return { dateFrom: `${y}-01-01`, dateTo: to, label: "this year" };
  }

  return null;
}
