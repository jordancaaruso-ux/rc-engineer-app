/**
 * What a setup is called when it's saved with one tap.
 *
 * Saving asks no questions (see `api/setup-snapshots/[id]/save`), so the name has to be built from
 * what the driver was already looking at. Two surfaces offer that tap — the All-setups list on the
 * car page and the Setup panel inside a session — and they must agree: the same setup saved from
 * either one has to land in the list under the same title, or it reads as two different setups.
 */

/** The `formatRunSessionDisplay` output for the run, e.g. "Q2" or "Testing run". */
type SessionNaming = {
  eventName?: string | null;
  sessionDisplay: string;
};

/**
 * A run of your own: the meeting, then the session. "Kingston Classic · Q2".
 *
 * No event (a test day) leaves the session standing alone, which is what the car page has always
 * shown for those rows.
 */
export function savedRunSetupName(input: SessionNaming): string {
  const event = input.eventName?.trim();
  const session = input.sessionDisplay.trim();
  return event ? `${event} · ${session}` : session;
}

/**
 * A teammate's run, copied onto one of your cars: whose it was, which session, which track.
 *
 * The driver's name leads because that is the thing you will search the list for later — "what was
 * Ben running" — and because a copy carries no other mark of where it came from (founder call,
 * 2026-08-15: name only, no provenance column). It is baked into the name rather than a live
 * lookup so it survives them leaving the team.
 */
export function teammateSetupCopyName(input: {
  driverName?: string | null;
  sessionDisplay: string;
  trackName?: string | null;
}): string {
  const parts = [
    input.driverName?.trim() || null,
    input.sessionDisplay.trim() || null,
    input.trackName?.trim() || null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "Teammate setup";
}
