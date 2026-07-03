/**
 * Session chain for a tire set: the ordered sessions the set has actually been run in,
 * derived entirely from its logged runs — never typed. In the wear-first picker this is
 * the set's earned identity ("3 runs · Q1 Q2 R"), the tie-breaker when two sets of the
 * same compound sit at the same run count.
 *
 * Per-run item priority (best → weakest), mirroring the retired anchor resolver but
 * compressed for row display:
 *   1. `meetingSessionCode` — free text the driver typed ("A1", "Q2").
 *   2. `sessionLabel`       — free-text session label (testing / practice / override).
 *   3. `meetingSessionType` — short code (P / S / Q / R) when no text was given.
 *   4. short date           — "Jul 3" from the run's best-known instant.
 */

export type ChainSourceRun = {
  meetingSessionCode?: string | null;
  meetingSessionType?: string | null;
  sessionLabel?: string | null;
  /** Best-known instant for ordering + the date fallback: sessionCompletedAt ?? createdAt. */
  when: Date;
};

const MEETING_TYPE_SHORT: Record<string, string> = {
  PRACTICE: "P",
  SEEDING: "S",
  QUALIFYING: "Q",
  RACE: "R",
  // OTHER intentionally omitted: its custom text lives in `meetingSessionCode` (caught first).
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function clip(s: string): string {
  return s.length > 10 ? `${s.slice(0, 9)}…` : s;
}

export function chainItemForRun(run: ChainSourceRun): string {
  const code = run.meetingSessionCode?.trim();
  if (code) return clip(code);

  const label = run.sessionLabel?.trim();
  if (label) return clip(label);

  const short = run.meetingSessionType ? MEETING_TYPE_SHORT[run.meetingSessionType] : undefined;
  if (short) return short;

  return `${MONTHS[run.when.getMonth()]} ${run.when.getDate()}`;
}

/**
 * Chronological chain with consecutive duplicates collapsed — four unlabeled runs on a
 * test day read as one "Jul 3", not "Jul 3 Jul 3 Jul 3 Jul 3".
 */
export function buildTireSetSessionChain(runs: ChainSourceRun[]): string[] {
  const sorted = [...runs].sort((a, b) => a.when.getTime() - b.when.getTime());
  const items: string[] = [];
  for (const run of sorted) {
    const item = chainItemForRun(run);
    if (items[items.length - 1] !== item) items.push(item);
  }
  return items;
}

/** Compact row display: last `max` items, "…"-prefixed when older history is trimmed. */
export function formatSessionChain(items: string[], max = 3): string {
  if (items.length === 0) return "";
  if (items.length <= max) return items.join(" ");
  return `… ${items.slice(-max).join(" ")}`;
}
