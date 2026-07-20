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
