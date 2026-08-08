/**
 * Geometry for the Events season timeline — pure date maths, no React, so the one
 * formula the whole hero rests on can be unit-tested.
 *
 * The handoff specifies a twelve-month year:
 *
 *     left% = ((dayOfYear(date) - 1) / daysInYear(year)) * 100
 *
 * This generalises it to any domain, because the year toggle also offers "All time",
 * and a lane of marks squeezed into a single January would be a lie about when the
 * driver raced. A year domain ticks by month; an all-time domain ticks by year. Same
 * positioning maths, same renderer — only the tick widths change.
 */

const MS_PER_DAY = 86_400_000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Event dates are stored at UTC noon, so every calculation here is UTC. */
function utc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

export type TimelineTick = {
  label: string;
  /** Width weight — days in the tick's span, so a 28-day February is narrower. */
  days: number;
  /** The tick containing today; the month axis brightens it. */
  current: boolean;
};

export type TimelineDomain = {
  startYmd: string;
  /** Inclusive last day. */
  endYmd: string;
  totalDays: number;
  ticks: TimelineTick[];
  /** Today's position as a percentage, or null when today falls outside the domain. */
  todayPct: number | null;
};

/**
 * Build the domain for a scope. `year: null` spans every year that has events, so the
 * all-time view stays proportional instead of pretending the whole history is one season.
 */
export function buildTimelineDomain(input: {
  year: number | null;
  /** Years with events, used only when `year` is null. */
  years: number[];
  todayYmd: string;
}): TimelineDomain {
  const { year, years, todayYmd } = input;
  const todayYear = Number(todayYmd.slice(0, 4));

  if (year != null) {
    const startYmd = `${year}-01-01`;
    const endYmd = `${year}-12-31`;
    const ticks = MONTHS.map((label, i) => ({
      label,
      days: daysInMonth(year, i),
      current: year === todayYear && i === Number(todayYmd.slice(5, 7)) - 1,
    }));
    return {
      startYmd,
      endYmd,
      totalDays: daysInYear(year),
      ticks,
      todayPct: pctFor(startYmd, daysInYear(year), todayYmd),
    };
  }

  // All time — span the full range of years that hold events, plus the current one so
  // "today" always has somewhere to sit.
  const span = years.length ? years : [todayYear];
  const first = Math.min(...span, todayYear);
  const last = Math.max(...span, todayYear);
  const startYmd = `${first}-01-01`;
  const endYmd = `${last}-12-31`;
  const totalDays = Math.round((utc(endYmd) - utc(startYmd)) / MS_PER_DAY) + 1;
  const ticks: TimelineTick[] = [];
  for (let y = first; y <= last; y++) {
    ticks.push({ label: String(y), days: daysInYear(y), current: y === todayYear });
  }
  return { startYmd, endYmd, totalDays, ticks, todayPct: pctFor(startYmd, totalDays, todayYmd) };
}

function pctFor(startYmd: string, totalDays: number, ymd: string): number | null {
  const offset = Math.round((utc(ymd) - utc(startYmd)) / MS_PER_DAY);
  if (offset < 0 || offset >= totalDays) return null;
  return (offset / totalDays) * 100;
}

/**
 * Where a date sits in the domain, as a percentage of its width. Returns null when the
 * date is outside — callers drop the marker rather than clamping it onto the edge, where
 * it would read as an event that happened in December.
 */
export function positionPct(domain: TimelineDomain, ymd: string): number | null {
  return pctFor(domain.startYmd, domain.totalDays, ymd);
}

/**
 * Width of a multi-day meeting as a percentage of the domain. The prototype hardcoded
 * 12px for a three-day title meeting; deriving it means a five-day meeting actually looks
 * longer than a three-day one.
 */
export function widthPct(domain: TimelineDomain, dayCount: number): number {
  return (Math.max(1, dayCount) / domain.totalDays) * 100;
}

/** `grid-template-columns: 31fr 28fr …` — month gridlines and the axis share one grid. */
export function tickColumns(domain: TimelineDomain): string {
  return domain.ticks.map((t) => `${t.days}fr`).join(" ");
}
