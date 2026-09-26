/**
 * A meeting's name without the track name it starts with, for a line that prints the track too.
 *
 * A new meeting is named "<track> · <day>" (`defaultEventName`), so a line joining the two printed
 * the track twice: "Indoor Raceway · Indoor Raceway · Sat 26 Sep" on the dashboard,
 * "INDOOR RACEWAY | INDOOR RACEWAY · SAT 26 SEP" on the share picture. What follows the track and
 * its separator is kept. A name that is only the track gives null, since the track says it all.
 *
 * Only a whole-word match counts, case aside: "Indoor Raceways Cup" is not the track
 * "Indoor Raceway" plus something, so it is kept whole. No track, or no match: the name as it is.
 */
export function meetingNameLessTrack(
  meetingName: string | null | undefined,
  trackName: string | null | undefined
): string | null {
  const name = meetingName?.trim() || null;
  const track = trackName?.trim();
  if (!name || !track) return name;
  if (name.slice(0, track.length).toLowerCase() !== track.toLowerCase()) return name;

  const rest = name.slice(track.length);
  if (!rest) return null;
  // The track must end at a space or a separator, not mid-word.
  if (!SEPARATOR_AT_START.test(rest)) return name;
  return rest.replace(SEPARATORS_AT_START, "").trim() || null;
}

const SEPARATOR_AT_START = /^[\s·•|:,/\-–—]/u;
const SEPARATORS_AT_START = /^[\s·•|:,/\-–—]+/u;
