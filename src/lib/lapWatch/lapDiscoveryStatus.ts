/**
 * What a lap-time scan found, in the pieces the card needs to lay it out.
 *
 * Discovery used to return one finished English sentence and the card printed it. Two things were
 * wrong with that. The fixes — Settings, the track's own timing page — could only be *described*,
 * never pressed; and one sentence had to cover states whose fixes have nothing in common. "Nobody
 * has uploaded yet" and "your name doesn't match what the track prints" are not the same problem
 * and must not read like one.
 *
 * The sentence still exists (`lapDiscoveryStatusMessage`) because older callers want a string, but
 * it is now derived from the state rather than being the state.
 */

import type { LapTimingSource } from "@/lib/lapImport/labels";

export type { LapTimingSource };

export type LapDiscoveryStatusCode =
  /** No driver name / transponder saved for this source — nothing to match against. */
  | "no_identity"
  /** Sessions are posted here, none of them resolved to this driver. */
  | "no_match"
  /** The source answered and has nothing for the day. */
  | "nothing_posted"
  /** Could not fetch the source (timeout, 5xx, live-meeting load). */
  | "unreachable"
  /** Sessions matched, but every one is already imported. */
  | "all_imported"
  /** The track carries no timing URL at all. */
  | "no_timing_page"
  /** The saved URL isn't a shape we can scan. */
  | "invalid_url";

/**
 * One row from the day, whoever it belongs to — what the "see the sessions from today" list draws.
 *
 * LiveRC only, deliberately. LiveRC publishes the whole day's list, so when name matching fails the
 * driver can find their own session in it and take it. Speedhive is asked for one transponder's
 * runs and answers with those, so it never has a day list to offer, and a driver could not claim
 * someone else's transponder session anyway.
 */
export type LapDiscoverySessionRow = {
  sessionId: string;
  sessionUrl: string;
  /**
   * What to show: the driver's name exactly as the timing site printed it (practice), or the race
   * name (results). Taken from the list link, never from the matcher's own row text — that one
   * glues the class and transponder onto the name to widen fuzzy matching, and reads as
   * "Cooper DavisModified (4344915)" on screen.
   */
  label: string;
  /** Second line when the site prints a transponder against the row — the other half of the fix. */
  detail: string | null;
  sessionCompletedAtIso: string | null;
  source: LapTimingSource;
};

export type LapDiscoveryStatus = {
  code: LapDiscoveryStatusCode;
  /** Which sources this state speaks for — more than one when a track carries both. */
  sources: LapTimingSource[];
  /** Sessions visible at the track for the day, ours or not. */
  postedCount: number;
  /** Sessions that resolved to this driver (imported or not). */
  matchedCount: number;
  /** The page we actually scanned, per source — the "open the track's timing page" button. */
  timingPages: { source: LapTimingSource; url: string }[];
  sessionsToday: LapDiscoverySessionRow[];
  /**
   * The day those sessions are actually from (YYYY-MM-DD, the club's own date), because it is
   * frequently not today. LiveRC's practice index resolves to the most recent day that has any
   * sessions on it, so a track last used on Monday answers a Thursday scan with Monday's list —
   * and calling that "posted today" is a plain lie to the driver standing at the track.
   */
  postedDayIso?: string | null;
  /**
   * Speedhive results that publish no transponder column at all. The transponder is then dead
   * weight and only the name can match, which changes what we ask the driver to check.
   */
  transponderNotPublished?: boolean;
};

export const SOURCE_LABELS: Record<LapTimingSource, string> = {
  liverc: "LiveRC",
  speedhive: "MYLAPS",
  myrcm: "MyRCM",
};

export function emptyLapDiscoveryStatus(
  code: LapDiscoveryStatusCode,
  source: LapTimingSource,
  extra?: Partial<LapDiscoveryStatus>
): LapDiscoveryStatus {
  return {
    code,
    sources: [source],
    postedCount: 0,
    matchedCount: 0,
    timingPages: [],
    sessionsToday: [],
    ...extra,
  };
}

/**
 * Which state wins when a track carries both LiveRC and MYLAPS.
 *
 * Ranked by how much the driver can do about it: a name that doesn't match a posted session is
 * fixable right now, an empty track is not. Before this, whichever source was listed first got to
 * speak and the other stayed silent — a track could have fourteen LiveRC sessions posted under a
 * name you'd typo'd and the card would report MYLAPS having nothing.
 */
const CODE_PRIORITY: Record<LapDiscoveryStatusCode, number> = {
  no_match: 0,
  no_identity: 1,
  all_imported: 2,
  unreachable: 3,
  nothing_posted: 4,
  invalid_url: 5,
  no_timing_page: 6,
};

export function mergeLapDiscoveryStatuses(
  statuses: (LapDiscoveryStatus | null | undefined)[]
): LapDiscoveryStatus | null {
  const present = statuses.filter(Boolean) as LapDiscoveryStatus[];
  if (present.length === 0) return null;
  if (present.length === 1) return present[0]!;

  const lead = [...present].sort(
    (a, b) => CODE_PRIORITY[a.code] - CODE_PRIORITY[b.code]
  )[0]!;

  // Counts and pages come from every source, not just the winner: the card says "23 sessions
  // posted today" about the track, and offers a door to each site it actually looked at.
  return {
    code: lead.code,
    sources: [...new Set(present.flatMap((s) => s.sources))],
    postedCount: present.reduce((n, s) => n + s.postedCount, 0),
    matchedCount: present.reduce((n, s) => n + s.matchedCount, 0),
    timingPages: present.flatMap((s) => s.timingPages),
    sessionsToday: present.flatMap((s) => s.sessionsToday),
    postedDayIso: present.find((s) => s.postedDayIso)?.postedDayIso ?? null,
    transponderNotPublished: present.some((s) => s.transponderNotPublished),
  };
}

/** Plain-sentence form, for callers that still want one string (watch nudges, older routes). */
export function lapDiscoveryStatusMessage(status: LapDiscoveryStatus): string {
  const names = status.sources.map((s) => SOURCE_LABELS[s]).join(" and ");
  const n = status.postedCount;
  switch (status.code) {
    case "no_identity":
      return "Add your driver name and transponder number in Settings to find your sessions here.";
    case "no_match":
      return n > 0
        ? `${n} session${n === 1 ? "" : "s"} posted today at this track, none of them yours.`
        : `Nothing here matched you on ${names}.`;
    case "nothing_posted":
      return "Nothing posted at this track yet.";
    case "unreachable":
      return `Couldn't reach ${names} just now.`;
    case "all_imported":
      return `Nothing new to import — the ${status.matchedCount} found for you here are already in.`;
    case "no_timing_page":
      return "This track has no timing page saved.";
    case "invalid_url":
      return "This track's timing link isn't one we can scan.";
  }
}
