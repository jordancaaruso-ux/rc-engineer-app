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
 * Race Meeting: type label (or custom when Other) + optional sessionLabel.
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

  const parts: string[] = [];
  if (type) {
    if (type === "OTHER" && custom) {
      parts.push(custom);
    } else {
      parts.push(MEETING_SESSION_TYPE_LABELS[type] ?? type);
    }
  }
  if (label) parts.push(label);
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

  const parts: string[] = [];
  if (type === "OTHER") {
    // The code IS the name here — there is no type label to pair it with.
    if (code) parts.push(code);
  } else if (type) {
    const typeLabel = MEETING_SESSION_TYPE_LABELS[type] ?? type;
    parts.push(code ? `${typeLabel} ${sessionCodeSuffix(code, typeLabel)}` : typeLabel);
  } else if (code) {
    parts.push(code);
  }
  if (label) parts.push(label);
  return parts.length > 0 ? parts.join(" · ") : unlabeled();
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
