/**
 * How an outing names itself — one rule, used by every surface that heads a day.
 *
 * A meeting has a name of its own, so it takes the heading and keeps the venue and
 * the date on the line beneath. A test day has no name; it is identified by WHERE it
 * happened, so the track takes the heading, the word "testing" joins it there, and
 * only the date is left below.
 *
 * Both halves of that rule exist because their absence was visible on screen:
 *   - `/analysis` printed "TFTR" over "TFTR · 19 July 2026", spending a whole line
 *     to repeat one word.
 *   - the Sessions day screen printed "TEST DAY" beside a badge reading "TEST DAY",
 *     because a testing group's stored title is literally that string.
 *
 * ## The kind is a WORD in the heading, not a badge (founder pin, 2026-08-26)
 *
 * "TFTR" used to be followed by a bordered pill reading "TEST DAY" — the only object
 * of its kind on any heading in the app, so it read as something imported from
 * another product rather than as part of this one. The heading carries the word
 * itself now: "TFTR TESTING". Same fact, no chrome.
 *
 * An EVENT gets no such word. A meeting's own name already says what the day was,
 * and "AARC ROUND 3 EVENT" labels the obvious. A test day with no track keeps the
 * bare "Test day" placeholder — "Test day testing" is not a sentence.
 *
 * Prisma-free and React-free on purpose: the server loader and the client card both
 * import it, so the two cannot drift into naming one day two different ways.
 */
export type OutingHeadingParts = {
  /** Goes in the heading. */
  title: string;
  kind: "Event" | "Testing";
  /** Goes on the line beneath — never repeats the title. */
  where: string;
};

export function resolveOutingHeading(input: {
  /** The group's stored title: a meeting's name, or the "Test day" placeholder. */
  title: string;
  type: "Event" | "Testing";
  trackName: string | null;
  dateLabel: string;
}): OutingHeadingParts {
  // "—" is the Sessions rail's own empty marker, not a venue.
  const track =
    input.trackName?.trim() && input.trackName.trim() !== "—" ? input.trackName.trim() : null;
  const isEvent = input.type === "Event";
  const title = isEvent ? input.title : track ? `${track} testing` : "Test day";
  const where = [isEvent && track ? track : null, input.dateLabel].filter(Boolean).join(" · ");
  return { title, kind: input.type, where };
}
