/**
 * Run session: meeting session type and display formatting.
 * Used by New Run form and Run History.
 */

export type MeetingSessionType = "PRACTICE" | "SEEDING" | "QUALIFYING" | "RACE" | "OTHER";

const MEETING_SESSION_TYPE_LABELS: Record<string, string> = {
  PRACTICE: "Practice",
  SEEDING: "Seeding",
  QUALIFYING: "Qualifying",
  RACE: "Race",
  OTHER: "Other",
};

/**
 * Format run session for display (e.g. Run History).
 * Event: type label (or custom when Other) + optional sessionLabel.
 * Testing: sessionLabel, else `Run <dayRunNumber>` / `opts.fallback` / "—".
 * Surfaces that know the run's position within its day should pass
 * `dayRunNumber` so unlabeled testing runs get a real name instead of a dash.
 */
export function formatRunSessionDisplay(
  run: {
    sessionType: string;
    meetingSessionType?: string | null;
    meetingSessionCode?: string | null;
    sessionLabel?: string | null;
  },
  opts?: { dayRunNumber?: number | null; fallback?: string }
): string {
  const unlabeled = () => {
    if (opts?.dayRunNumber != null) return `Run ${opts.dayRunNumber}`;
    return opts?.fallback ?? "—";
  };
  if (run.sessionType !== "RACE_MEETING" && run.sessionType !== "PRACTICE") {
    return run.sessionLabel?.trim() || unlabeled();
  }
  const type = run.meetingSessionType;
  const custom = run.meetingSessionCode?.trim(); // when type is OTHER
  const label = run.sessionLabel?.trim();

  const typePart =
    type != null
      ? type === "OTHER" && custom
        ? custom
        : MEETING_SESSION_TYPE_LABELS[type] ?? type
      : null;
  const parts = joinSessionParts(typePart, label ?? null, typeWord(type));
  return parts.length > 0 ? parts.join(" · ") : unlabeled();
}

/**
 * The session's NAME, for a row that has room for one — "Qualifying 2", "Race 3",
 * "Run 4".
 *
 * `formatRunSessionDisplay` deliberately drops `meetingSessionCode` unless the
 * type is OTHER, so every qualifier in a weekend comes back as the bare word
 * "Qualifying" and three of them in a list are indistinguishable. The code is
 * where the number lives ("Q2" for qualifying, "2" for practice and race), so
 * this reads it back out and prints the pair.
 *
 * Splitting it from `shortRunLabel` rather than widening that one: the chart's
 * x-axis has room for about four characters at 390px and shares the width
 * between every run in the session, so it keeps the code. Rows take this.
 *
 * The number is extracted rather than concatenated because the type letter is
 * usually already in the code — "Qualifying Q2" is what you get otherwise. A
 * code that carries more than a leading type letter (a main's "A2") is printed
 * whole, since dropping its letter would merge the A and B mains.
 */
export function runSessionName(
  run: {
    /** Optional so callers holding a partial run row can pass it straight in; a
        missing type takes the testing branch, which is the honest default. */
    sessionType?: string | null;
    meetingSessionType?: string | null;
    meetingSessionCode?: string | null;
    sessionLabel?: string | null;
  },
  opts?: { dayRunNumber?: number | null; fallback?: string }
): string {
  const unlabeled = () => {
    if (opts?.dayRunNumber != null) return `Run ${opts.dayRunNumber}`;
    return opts?.fallback ?? "—";
  };
  if (run.sessionType !== "RACE_MEETING" && run.sessionType !== "PRACTICE") {
    return run.sessionLabel?.trim() || unlabeled();
  }

  const type = run.meetingSessionType;
  const code = run.meetingSessionCode?.trim();
  const label = run.sessionLabel?.trim();

  let typePart: string | null = null;
  if (type === "OTHER") {
    // The code IS the name here — there is no type label to pair it with.
    typePart = code ?? null;
  } else if (type) {
    const typeLabel = MEETING_SESSION_TYPE_LABELS[type] ?? type;
    typePart = code ? `${typeLabel} ${sessionCodeSuffix(code, typeLabel)}` : typeLabel;
  } else if (code) {
    typePart = code;
  }
  const parts = joinSessionParts(typePart, label ?? null, typeWord(type));
  return parts.length > 0 ? parts.join(" · ") : unlabeled();
}

/**
 * The bare word a timing site's own label might already begin with. Null for OTHER,
 * where the "type" is the driver's own words and repeating them is their business.
 */
function typeWord(type: string | null | undefined): string | null {
  if (!type || type === "OTHER") return null;
  return MEETING_SESSION_TYPE_LABELS[type] ?? type;
}

/** Prefix match on a word boundary: "Practice 3" starts with "Practice", "Practices" does not. */
function startsWithWord(text: string, word: string): boolean {
  if (text.length < word.length) return false;
  if (text.slice(0, word.length).toLowerCase() !== word.toLowerCase()) return false;
  const next = text.charAt(word.length);
  return next === "" || !/[a-z0-9]/i.test(next);
}

/**
 * The type part and the session label, joined without stuttering.
 *
 * A timing provider's own session name lands in `sessionLabel` verbatim — `classifySession`
 * keeps the whole string — and it usually already opens with the type word, so an imported
 * "Practice 3" under type PRACTICE printed as "Practice · Practice 3". When the label starts
 * with the type's word the label wins outright: it is the more specific of the two, and it
 * carries the number the type part does not.
 */
function joinSessionParts(
  typePart: string | null,
  label: string | null,
  bareTypeWord: string | null
): string[] {
  if (label && bareTypeWord && startsWithWord(label, bareTypeWord)) return [label];
  return [typePart, label].filter((part): part is string => Boolean(part));
}

/** One run's name within its day, and whether that name is really just its position. */
export type DayRunName = {
  /** What to print. */
  label: string;
  /** The run's place in the day, set ONLY when the label is that position; null for a real name. */
  position: number | null;
};

/**
 * Name a day's runs so that no two of them read the same.
 *
 * A session is named by its TYPE — "Practice", "Qualifying" — and no number is stored
 * alongside it: the log-run form only writes `meetingSessionCode` when the driver picks
 * "Other" and types one. So a day of five practice sessions produced five runs all named
 * "Practice", and every surface that names one run out of the day ("Best run was Practice")
 * was pointing at nothing (founder report, 2026-08-25).
 *
 * The fix deliberately does NOT invent a session number. "Practice 3" would be the app
 * guessing at the event's timetable, and it would sit next to a printed sheet that may
 * well say Practice 2. Instead, when a name is shared by more than one run in the day it
 * carries no information at all, so it is replaced by the one thing that is certainly
 * true — where the run came in the day (founder call, 2026-08-25: "Run 3 of 5").
 *
 * Names that are already unique are left completely alone, so a mixed race day still
 * reads "Qualifying", "A Main", and only the repeated ones become positions.
 *
 * `dayRunNumber` is the CALLER's numbering (the dashboard counts today's runs, the
 * Sessions workbench counts per car) — this only decides when to print it.
 */
export function resolveDayRunNames(
  named: readonly { name: string; dayRunNumber: number }[]
): DayRunName[] {
  const uses = new Map<string, number>();
  for (const entry of named) {
    const key = entry.name.trim().toLowerCase();
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  return named.map((entry) => {
    const positional = `Run ${entry.dayRunNumber}`;
    const shared = (uses.get(entry.name.trim().toLowerCase()) ?? 0) > 1;
    const label = shared ? positional : entry.name;
    // A run that was ALREADY named by position (the unlabeled-testing fallback) reports
    // itself as positional too, so a sentence built from it reads the same either way.
    return { label, position: label === positional ? entry.dayRunNumber : null };
  });
}

/**
 * What follows the type label.
 *
 * A leading letter is dropped ONLY when it is the type's own initial, which is
 * the case the codes were designed around: qualifying stores "Q2", so
 * "Qualifying Q2" would stutter. Any other letter is somebody's meaning and
 * survives — "A2" under RACE is the A main, and stripping it to "2" would make
 * the A and B mains print identically.
 */
function sessionCodeSuffix(code: string, typeLabel: string): string {
  const prefixed = /^([A-Za-z])(\d+)$/.exec(code);
  if (prefixed && prefixed[1]!.toUpperCase() === typeLabel[0]!.toUpperCase()) return prefixed[2]!;
  return code;
}
