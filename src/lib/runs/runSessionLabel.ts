/**
 * What "the session" is, as one closed list of choices.
 *
 * ============================== WHY A VOCABULARY AND NOT A STRING ==============================
 *
 * The session a run belongs to is stored across three columns — `sessionType`
 * (TESTING / PRACTICE / RACE_MEETING), `meetingSessionType` (PRACTICE / SEEDING /
 * QUALIFYING / RACE / OTHER) and `meetingSessionCode` (the free-text name when it
 * is OTHER). Only some combinations mean anything: a TESTING run with a meeting
 * type is a contradiction, and a RACE_MEETING run without one reads as "—".
 *
 * The run page lets a driver fix a mislabelled session in place (founder call,
 * 2026-08-20 — "session too"), so the picker and the route that writes it have to
 * agree on which combinations are legal. They agree by both importing this file:
 * the client renders these options, and the route accepts nothing else.
 *
 * ============================== WHAT THIS DELIBERATELY DOES NOT TOUCH ==============================
 *
 * The event, the track and the timestamp. The founder scoped "session" to the
 * label alone: which day this run belongs to is a different question, answered by
 * the event picker beside it, and the track and time are fixed once logged.
 */

export type RunSessionLabelOptionId =
  | "testing"
  | "practice"
  | "seeding"
  | "qualifying"
  | "race"
  | "other";

export type RunSessionLabelOption = {
  id: RunSessionLabelOptionId;
  label: string;
  sessionType: "TESTING" | "RACE_MEETING";
  meetingSessionType: "PRACTICE" | "SEEDING" | "QUALIFYING" | "RACE" | "OTHER" | null;
};

export const RUN_SESSION_LABEL_OPTIONS: readonly RunSessionLabelOption[] = [
  { id: "testing", label: "Testing", sessionType: "TESTING", meetingSessionType: null },
  { id: "practice", label: "Practice", sessionType: "RACE_MEETING", meetingSessionType: "PRACTICE" },
  { id: "seeding", label: "Seeding", sessionType: "RACE_MEETING", meetingSessionType: "SEEDING" },
  {
    id: "qualifying",
    label: "Qualifying",
    sessionType: "RACE_MEETING",
    meetingSessionType: "QUALIFYING",
  },
  { id: "race", label: "Race", sessionType: "RACE_MEETING", meetingSessionType: "RACE" },
  { id: "other", label: "Something else…", sessionType: "RACE_MEETING", meetingSessionType: "OTHER" },
];

export function runSessionLabelOption(
  id: string | null | undefined
): RunSessionLabelOption | null {
  return RUN_SESSION_LABEL_OPTIONS.find((o) => o.id === id) ?? null;
}

/**
 * Which option a stored run is already on.
 *
 * A legacy `PRACTICE` sessionType (the third enum member, from before practice
 * became a meeting session) reads as Practice rather than falling through to
 * Testing — otherwise opening the picker on one of those runs would show the
 * wrong row ticked and quietly relabel it on the next save.
 */
export function runSessionLabelOptionIdFor(run: {
  sessionType: string;
  meetingSessionType?: string | null;
}): RunSessionLabelOptionId {
  if (run.sessionType === "TESTING") return "testing";
  if (run.sessionType === "PRACTICE" && !run.meetingSessionType) return "practice";
  switch (run.meetingSessionType) {
    case "PRACTICE":
      return "practice";
    case "SEEDING":
      return "seeding";
    case "QUALIFYING":
      return "qualifying";
    case "RACE":
      return "race";
    case "OTHER":
      return "other";
    default:
      return run.sessionType === "TESTING" ? "testing" : "practice";
  }
}

/**
 * The columns a chosen option writes.
 *
 * `meetingSessionCode` only survives on OTHER — it is the name of a session type
 * the list does not have, so on any listed type it is a leftover that would keep
 * printing over the real label. `sessionLabel` ("Main") is cleared for the same
 * reason whenever the type moves: it qualifies a race, and a qualifier is not a
 * "Main".
 */
export function runSessionLabelColumns(
  option: RunSessionLabelOption,
  opts?: { code?: string | null; keepSessionLabel?: string | null }
): {
  sessionType: "TESTING" | "RACE_MEETING";
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  sessionLabel: string | null;
} {
  const isOther = option.meetingSessionType === "OTHER";
  return {
    sessionType: option.sessionType,
    meetingSessionType: option.meetingSessionType,
    meetingSessionCode: isOther ? (opts?.code?.trim() || null) : null,
    sessionLabel: option.meetingSessionType === "RACE" ? (opts?.keepSessionLabel ?? null) : null,
  };
}
