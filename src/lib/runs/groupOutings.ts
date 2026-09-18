import type { OutingKind, Span } from "@/lib/runs/outingSpan";

/**
 * One run per time on track (founder ruling 2026-09-15).
 *
 * Every timing session the day produced — from both sites, race loop and practice loop — is
 * gathered first and only then filed, so there is no race between sources and nothing to undo.
 * Two rules decide what is the same outing:
 *
 *   1. Windows that overlap are one outing. A heat on LiveRC and the same heat on Speedhive;
 *      a practice-loop block that ran during a heat; a timed practice session that spans the
 *      5-lap-then-back-out fragments the practice feed split it into.
 *   2. Practice fragments separated by less than a pit stop (`PIT_STOP_GAP_MS`) are one outing.
 *      Only practice joins practice this way: a heat is over when it is over, and a block that
 *      starts a minute after it is the next thing, not the same thing.
 *
 * Inside an outing the OFFICIAL record leads — it carries the field and the finishing order — and
 * the rest ride along as linked sources. Among equals, the fuller sheet (more drivers, then more
 * laps) is primary. Pure so the rules are unit-tested.
 */

export type OutingSession = Span & {
  id: string;
  kind: OutingKind;
  /** Drivers on the sheet — 1 for a chip's own practice block, the whole field for a heat. */
  driverCount: number;
  lapCount: number;
};

export type Outing = Span & {
  primaryId: string;
  /** Primary first, then the rest in start order. */
  sessionIds: string[];
  kind: OutingKind;
};

/** A stop shorter than this inside a practice run is a pit stop, not a new run. */
export const PIT_STOP_GAP_MS = 3 * 60 * 1000;

export function groupOutings(
  sessions: readonly OutingSession[],
  opts: { pitStopGapMs?: number } = {},
): Outing[] {
  const gap = opts.pitStopGapMs ?? PIT_STOP_GAP_MS;
  const sorted = [...sessions].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      a.end.getTime() - b.end.getTime() ||
      a.id.localeCompare(b.id),
  );

  const clusters: OutingSession[][] = [];
  let current: OutingSession[] = [];
  let currentEnd = Number.NEGATIVE_INFINITY;
  let currentAllPractice = true;

  for (const s of sorted) {
    if (current.length > 0) {
      const overlaps = s.start.getTime() <= currentEnd;
      const pitStop = currentAllPractice && s.kind === "practice" && s.start.getTime() - currentEnd < gap;
      if (overlaps || pitStop) {
        current.push(s);
        currentEnd = Math.max(currentEnd, s.end.getTime());
        currentAllPractice = currentAllPractice && s.kind === "practice";
        continue;
      }
      clusters.push(current);
    }
    current = [s];
    currentEnd = s.end.getTime();
    currentAllPractice = s.kind === "practice";
  }
  if (current.length > 0) clusters.push(current);

  return clusters.map(toOuting);
}

function toOuting(cluster: OutingSession[]): Outing {
  const primary = [...cluster].sort(comparePrimary)[0]!;
  const rest = cluster.filter((s) => s.id !== primary.id);
  let start = cluster[0]!.start;
  let end = cluster[0]!.end;
  for (const s of cluster) {
    if (s.start < start) start = s.start;
    if (s.end > end) end = s.end;
  }
  return {
    primaryId: primary.id,
    sessionIds: [primary.id, ...rest.map((s) => s.id)],
    kind: primary.kind,
    start,
    end,
  };
}

type OutingSheet = Pick<OutingSession, "kind" | "driverCount" | "lapCount">;

/**
 * Which of two records of one outing leads: official before practice, then the fuller sheet (more
 * drivers, then more laps). 0 when neither does. The lap step's same-race rule
 * (`lapImport/sameOutingBlocks.ts`) ranks by this too, so both doors pick the same record.
 */
export function compareOutingSheets(a: OutingSheet, b: OutingSheet): number {
  if (a.kind !== b.kind) return a.kind === "official" ? -1 : 1;
  if (a.driverCount !== b.driverCount) return b.driverCount - a.driverCount;
  return b.lapCount - a.lapCount;
}

/** Official before practice; then the fuller sheet; then the earlier one; then a stable id. */
function comparePrimary(a: OutingSession, b: OutingSession): number {
  const sheet = compareOutingSheets(a, b);
  if (sheet !== 0) return sheet;
  const t = a.start.getTime() - b.start.getTime();
  if (t !== 0) return t;
  return a.id.localeCompare(b.id);
}
