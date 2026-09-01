/**
 * What to call an imported timing session.
 *
 * One definition, because the library list and the sheet header both name the same row and
 * had no business disagreeing. The first cut named every row after a driver — whichever one
 * `primaryLapRowsFromImportedPayload` happened to reach first — which on a LiveRC race sheet
 * is an arbitrary entrant. Twenty rows of a hub expansion came out as twenty strangers' names
 * against the same timestamp, with nothing on screen saying which race any of them was.
 *
 * So the SESSION names the row when the session has a name: the detection label, the class,
 * whatever the timing site printed. A driver's name is the right title for exactly one shape
 * of import — a practice sheet, where the driver IS the session.
 */

/**
 * A parser's diagnostic marker is not a session name.
 *
 * The LiveRC race parser filed `racer_laps_session_loaded` in `sessionHint.className` as a
 * breadcrumb, and this function printed it as the title of every race anyone pasted in — 206
 * of one account's sessions. The parser no longer does it; this is the floor, so no future
 * parser can put an identifier on a driver's screen by writing to the wrong field.
 *
 * The test is a whole string of lowercase-and-underscores with no spaces. Real session names
 * have spaces or capitals (`ISTC Modified A3-Main`, `Heat 25 Qualy 2`, `13.5 Stock`); a class
 * that genuinely reads `stock_blinky` loses nothing worth keeping.
 */
function isMachineMarker(v: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(v);
}

function usable(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  return isMachineMarker(t) ? null : t;
}

export function importedSessionTitle(input: {
  eventDetectionSessionLabel?: string | null;
  eventRaceClass?: string | null;
  eventDetectionSource?: string | null;
  parsedPayload?: unknown;
  /** Leading driver on the sheet; used only when the session has no name of its own. */
  driverName?: string | null;
  /** Entrants with laps. Above one, a driver's name can't be the title. */
  driverCount?: number;
}): string {
  const label = usable(input.eventDetectionSessionLabel);
  if (label) return label;

  const cls = usable(input.eventRaceClass);
  if (cls) return cls;

  const hint =
    input.parsedPayload && typeof input.parsedPayload === "object"
      ? ((input.parsedPayload as Record<string, unknown>).sessionHint as
          | { name?: string | null; className?: string | null }
          | undefined)
      : undefined;
  const hinted = usable(hint?.name) || usable(hint?.className);
  if (hinted) return hinted;

  const driver = usable(input.driverName);
  if (driver && (input.driverCount ?? 1) <= 1) return driver;

  /*
   * Last resort, and it has to be honest rather than tidy. `eventDetectionSource` is only
   * set on sessions that arrived through event detection, so a pasted URL reaches here with
   * nothing — and calling a three-car A-main "Practice" is worse than saying little. More
   * than one entrant with laps is a race everywhere except a shared practice sheet, which
   * every provider we read hands over one driver at a time.
   */
  if (input.eventDetectionSource === "practice") return "Practice";
  if (input.eventDetectionSource === "race") return "Race";
  return (input.driverCount ?? 1) > 1 ? "Race" : "Practice";
}
