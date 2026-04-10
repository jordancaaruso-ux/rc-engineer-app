import { bestLap, formatLap } from "@/lib/runLaps";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { formatRunPickerScanDate } from "@/lib/formatDate";

/** Run shape needed for picker line (API + server components). */
export type RunPickerRun = {
  id: string;
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  event?: { name: string } | null;
  /** Present when API returns car-scoped runs. */
  carId?: string | null;
  car?: { name: string } | null;
  carNameSnapshot?: string | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
  lapTimes?: unknown;
  /** Present when run comes from for-picker / last APIs (load setup). */
  setupSnapshot?: { id: string; data: unknown } | null;
  /** On-track session time when known (import). */
  sessionCompletedAt?: Date | string | null;
};

function pickRunInstant(run: RunPickerRun): Date | string {
  return run.sessionCompletedAt ?? run.createdAt;
}

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
  if (diffDays < 0) return formatRunPickerScanDate(createdAt);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays >= 2 && diffDays <= 5) return `${diffDays} days ago`;
  return formatRunPickerScanDate(createdAt);
}

/** Run type segment: meeting session vs testing label (leading context is handled separately). */
function formatRunPickerRunTypeSegment(run: RunPickerRun): string {
  if (run.sessionType === "TESTING") {
    return run.sessionLabel?.trim() || "Run";
  }
  if (run.sessionType === "RACE_MEETING" || run.sessionType === "PRACTICE") {
    const s = formatRunSessionDisplay(run);
    return s === "—" ? "Session" : s;
  }
  return run.sessionLabel?.trim() || "Run";
}

function formatRunListScanLead(run: RunPickerRun): string {
  const eventName = run.event?.name?.trim();
  if (eventName) return eventName;
  if (run.eventId) return "Event";
  const d = formatRunPickerScanDate(pickRunInstant(run));
  return d === "—" ? "Testing —" : `Testing ${d}`;
}

/**
 * Context-first line for pickers and copy-last-run preview:
 * event name, else `Testing <date>`, then run type, track, car.
 */
export function formatRunListScanLine(run: RunPickerRun): string {
  const lead = formatRunListScanLead(run);
  const runType = formatRunPickerRunTypeSegment(run);
  const track = run.track?.name ?? run.trackNameSnapshot ?? "—";
  const car = run.car?.name ?? run.carNameSnapshot ?? "—";
  return `${lead} — ${runType} — ${track} — ${car}`;
}

function appendBestLap(base: string, lapTimes: unknown): string {
  const lap = bestLap(lapTimes);
  if (lap == null) return base;
  return `${base} — ${formatLap(lap)}`;
}

/**
 * One-line summary for run pickers (compare, setup modal, history).
 */
export function formatRunPickerLine(run: RunPickerRun): string {
  return appendBestLap(formatRunListScanLine(run), run.lapTimes);
}

/** Compact “when” segment using session time when set. */
export function formatRunPickerWhenSegment(run: RunPickerRun): string {
  return formatRunCreatedRelativeWhen(pickRunInstant(run));
}

/**
 * Load-setup control + New Run picker (same scan order as {@link formatRunPickerLine}; name kept for call sites).
 */
export function formatRunPickerLineRelativeWhen(run: RunPickerRun): string {
  return formatRunPickerLine(run);
}
