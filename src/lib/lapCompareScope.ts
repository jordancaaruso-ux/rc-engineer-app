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
 *   `field:<runId>:<setId>` — a rival off the timing sheet of ANOTHER run in the
 *                   picker, so a competitor's first heat can be measured against
 *                   this one. Scoped exactly like the `history:` row of that run.
 *   `librace:<sessionId>:<driverId>` — one driver in a race brought into the library
 *                   and on none of the viewer's runs. Scoped like `library:`.
 */

/** All three are within the sheet's track; there is no wider look (founder call, 2026-09-24). */
export type LapCompareScope = "same_day" | "same_event" | "same_track";

const FIELD_PREFIX = "field:";
const LIBRARY_RACE_PREFIX = "librace:";

export function lapCompareFieldSeriesId(runId: string, setId: string): string {
  return `${FIELD_PREFIX}${runId}:${setId}`;
}

/** `field:<runId>:<setId>` → the run the timing sheet hangs off; null for any other id. */
export function lapCompareFieldSeriesRunId(seriesId: string): string | null {
  if (!seriesId.startsWith(FIELD_PREFIX)) return null;
  const rest = seriesId.slice(FIELD_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

export function lapCompareLibraryRaceSeriesId(sessionId: string, driverId: string): string {
  return `${LIBRARY_RACE_PREFIX}${sessionId}:${driverId}`;
}

/** `librace:<sessionId>:<driverId>` → the imported session; null for any other id. */
export function lapCompareLibraryRaceSessionId(seriesId: string): string | null {
  if (!seriesId.startsWith(LIBRARY_RACE_PREFIX)) return null;
  const rest = seriesId.slice(LIBRARY_RACE_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

/** A session from the viewer's library, on none of their runs: `library:` or `librace:`. */
export function lapCompareIsLibrarySeries(seriesId: string): boolean {
  return seriesId.startsWith("library:") || seriesId.startsWith(LIBRARY_RACE_PREFIX);
}

/**
 * Track identity for scoping, keyed on the resolved NAME rather than the id: imported
 * and legacy rows routinely carry only a `trackNameSnapshot` with a null `trackId`, so
 * id-keying would hide a session run at the very venue you are standing at. Same rule
 * as `trackKey` in buildRunHistoryGroups.
 */
export function lapCompareTrackKey(name?: string | null): string | null {
  const trimmed = (name ?? "").trim().toLowerCase();
  return trimmed ? trimmed : null;
}

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
  /** Track of the anchor run, via {@link lapCompareTrackKey}. */
  anchorTrackKey?: string | null;
  /** Any series id → the track it was run at, via {@link lapCompareTrackKey}. */
  trackKeyForSeries?: (seriesId: string) => string | null | undefined;
}): boolean {
  const {
    seriesId,
    sortIso,
    scope,
    anchorInstantIso,
    anchorEventId = null,
    primaryRunEventId = null,
    eventIdForHistoryRun,
    anchorTrackKey = null,
    trackKeyForSeries,
  } = input;

  // Lap sets imported onto this run ARE this session — the rest of the race field
  // off the same timing sheet. No scope may hide them. `same_event` always let
  // them through (they share the anchor's event by construction); `same_day`
  // compared the timing sheet's wall time against the run's own logged time and
  // dropped the whole field whenever those disagreed — import an April session
  // into a run logged in August and the compare list came up empty.
  if (seriesId.startsWith("imported:")) return true;

  /*
   * Every scope is the anchor's track first (founder call, 2026-09-24: "you're only ever
   * comparing lap times from the same track"). "Was I quicker here?" is the question a lap
   * sheet is opened to answer, and a time from another circuit answers nothing. A series whose
   * track is unknown (an import never linked to a run and not matched to a club) is dropped
   * rather than guessed at. Only a sheet whose OWN track is unknown lets everything through:
   * it cannot say what "here" is, and hiding every session would be a dead end.
   */
  if (seriesId !== "run:primary" && anchorTrackKey) {
    if ((trackKeyForSeries?.(seriesId) ?? null) !== anchorTrackKey) return false;
  }
  if (scope === "same_track") return true;
  if (scope === "same_day") return sameLocalCalendarDay(sortIso, anchorInstantIso);

  // same_event. With no event on the anchor there is nothing to match, so keep
  // everything attached to a run and drop the free-floating library sessions.
  if (!anchorEventId) return !lapCompareIsLibrarySeries(seriesId);

  if (seriesId === "run:primary") return primaryRunEventId === anchorEventId;
  // A rival off another run's timing sheet was at that run's event, by construction.
  const ownerRunId = seriesId.startsWith("history:")
    ? seriesId.slice("history:".length)
    : lapCompareFieldSeriesRunId(seriesId);
  if (ownerRunId) {
    return (eventIdForHistoryRun?.(ownerRunId) ?? null) === anchorEventId;
  }
  return false;
}
