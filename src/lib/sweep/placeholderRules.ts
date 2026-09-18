/**
 * Small rules the sweep and the wizard share about app-made runs and half-finished sessions.
 */

/** Four minutes of silence after the last lap: a practice block is over, not paused. */
export const SESSION_QUIET_MS = 4 * 60 * 1000;

/**
 * An app-made run is never precious. Only a run the app filed (unconfirmed) may be dissolved when a
 * human run claims its session; a run the driver confirmed keeps its laps whatever happens.
 */
export function isDissolvable(run: { unconfirmedAt: Date | null }): boolean {
  return run.unconfirmedAt != null;
}

/**
 * Never file a run that is still being driven. A block is closed when it is not the newest one
 * the timing site shows for that activity, or when its last lap is old enough that nobody is
 * still lapping. A block with no timestamps at all is filed — better late than never, and the
 * seen-list stops it being filed twice.
 */
export function sessionBlockIsClosed(
  block: { lastLapAt: Date | null; isNewest: boolean },
  now: Date,
  quietMs: number = SESSION_QUIET_MS,
): boolean {
  if (!block.isNewest) return true;
  if (!block.lastLapAt) return true;
  return now.getTime() - block.lastLapAt.getTime() >= quietMs;
}
