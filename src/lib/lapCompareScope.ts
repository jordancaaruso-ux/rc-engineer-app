/**
 * Which lap series survive the Scope filter in the lap column-compare sheet.
 *
 * The sheet mixes four kinds of series behind one id space, and the scope rule
 * differs per kind — which is how the race field imported onto a run came to be
 * hidden from its own compare list. Extracted from `LapComparisonColumnGrid` so
 * the prefix dispatch is testable.
 *
 *   `run:primary`  — the anchor run's own laps
 *   `imported:<id>`— the rest of the field from the timing sheet saved on that run
 *   `history:<id>` — another of the driver's runs
 *   `library:<id>` — a session from the viewer's imported lap-time library
 */

export type LapCompareScope = "all" | "same_day" | "same_event";

/** True when two ISO instants land on the same local calendar day. */
export function sameLocalCalendarDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function lapSeriesMatchesCompareScope(input: {
  seriesId: string;
  /** Session / run instant for this series, ISO. */
  sortIso: string;
  scope: LapCompareScope;
  /** Display instant of the run the sheet is anchored to, ISO. */
  anchorInstantIso: string;
  /** Event of the anchor run; null when it isn't in an event. */
  anchorEventId?: string | null;
  /** Event of the run holding the `run:primary` laps. */
  primaryRunEventId?: string | null;
  /** `history:<id>` → that run's event id. */
  eventIdForHistoryRun?: (runId: string) => string | null | undefined;
}): boolean {
  const {
    seriesId,
    sortIso,
    scope,
    anchorInstantIso,
    anchorEventId = null,
    primaryRunEventId = null,
    eventIdForHistoryRun,
  } = input;

  // Lap sets imported onto this run ARE this session — the rest of the race field
  // off the same timing sheet. No scope may hide them. `same_event` always let
  // them through (they share the anchor's event by construction); `same_day`
  // compared the timing sheet's wall time against the run's own logged time and
  // dropped the whole field whenever those disagreed — import an April session
  // into a run logged in August and the compare list came up empty.
  if (seriesId.startsWith("imported:")) return true;

  if (scope === "all") return true;
  if (scope === "same_day") return sameLocalCalendarDay(sortIso, anchorInstantIso);

  // same_event. With no event on the anchor there is nothing to match, so keep
  // everything attached to a run and drop the free-floating library sessions.
  if (!anchorEventId) return !seriesId.startsWith("library:");

  if (seriesId === "run:primary") return primaryRunEventId === anchorEventId;
  if (seriesId.startsWith("history:")) {
    const runId = seriesId.slice("history:".length);
    return (eventIdForHistoryRun?.(runId) ?? null) === anchorEventId;
  }
  return false;
}
