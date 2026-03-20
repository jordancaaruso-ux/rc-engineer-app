import { bestLap, formatLap } from "@/lib/runLaps";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { RUN_DATETIME_LOCALE } from "@/lib/formatDate";

/** Run shape needed for picker line (API + server components). */
export type RunPickerRun = {
  id: string;
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  car?: { name: string } | null;
  carNameSnapshot?: string | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
  lapTimes: unknown;
  /** Present when run comes from for-picker / last APIs (load setup). */
  setupSnapshot?: { data: unknown } | null;
};

/** Session segment: label if set, else meeting/testing fallback. */
export function formatRunPickerSessionSegment(run: {
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
}): string {
  if (run.sessionLabel?.trim()) return run.sessionLabel.trim();
  if (run.sessionType === "TESTING") return "Testing";
  const line = formatRunSessionDisplay(run);
  return line !== "—" ? line : "Session";
}

const MS_PER_DAY = 86400000;
const DATE_FALLBACK: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const PICKER_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

/** Local calendar start-of-day for the given instant (user's timezone). */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Whole calendar days from run day → today (local). 0 = same calendar day as today.
 */
export function runCreatedLocalDaysAgo(createdAt: Date | string): number {
  const run = new Date(createdAt);
  if (Number.isNaN(run.getTime())) return 999;
  const runDay = startOfLocalDay(run);
  const today = startOfLocalDay(new Date());
  return Math.round((today.getTime() - runDay.getTime()) / MS_PER_DAY);
}

/**
 * First segment for Load-setup dropdown: Today / Yesterday / N days ago / formatted date.
 */
export function formatRunCreatedRelativeWhen(createdAt: Date | string): string {
  const run = new Date(createdAt);
  if (Number.isNaN(run.getTime())) return "—";
  const diffDays = runCreatedLocalDaysAgo(createdAt);
  if (diffDays < 0) return run.toLocaleDateString(RUN_DATETIME_LOCALE, DATE_FALLBACK);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays >= 2 && diffDays <= 5) return `${diffDays} days ago`;
  return run.toLocaleDateString(RUN_DATETIME_LOCALE, DATE_FALLBACK);
}

/**
 * Compact one-line summary with absolute date+time (e.g. Analyze choose-run).
 */
export function formatRunPickerLine(run: RunPickerRun): string {
  const d = new Date(run.createdAt);
  const datePart = d.toLocaleDateString(RUN_DATETIME_LOCALE, { day: "numeric", month: "short" });
  let timePart = new Intl.DateTimeFormat(RUN_DATETIME_LOCALE, PICKER_TIME_OPTIONS).format(d);
  timePart = timePart.replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase());
  const session = formatRunPickerSessionSegment(run);
  const car = run.car?.name ?? run.carNameSnapshot ?? "—";
  const track = run.track?.name ?? run.trackNameSnapshot ?? "—";
  const lap = formatLap(bestLap(run.lapTimes));
  return `${datePart} ${timePart} · ${session} · ${car} · ${track} · ${lap}`;
}

/**
 * Same as formatRunPickerLine but leading segment is relative for recent runs (Log your run → Load setup).
 */
export function formatRunPickerLineRelativeWhen(run: RunPickerRun): string {
  const when = formatRunCreatedRelativeWhen(run.createdAt);
  const session = formatRunPickerSessionSegment(run);
  const car = run.car?.name ?? run.carNameSnapshot ?? "—";
  const track = run.track?.name ?? run.trackNameSnapshot ?? "—";
  const lap = formatLap(bestLap(run.lapTimes));
  return `${when} · ${session} · ${car} · ${track} · ${lap}`;
}
