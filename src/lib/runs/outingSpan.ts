import { parseSpeedhivePracticeActivityRef } from "@/lib/speedhive/speedhivePracticeUrl";

/**
 * A timing session's time on track, and what kind of record it is — the two facts the outing
 * rule (`groupOutings.ts`) needs. Pure; the DB-facing builder is `outingsFromImportedSessions.ts`.
 *
 * Founder ruling 2026-09-15: one run per time on track. A track with two timing links posts the
 * same heat twice (LiveRC and Speedhive, or a practice loop beside the race loop), and a practice
 * feed splits one outing on every pit stop. Sessions are matched by the WINDOW they cover, never
 * by "started within N minutes" — a 5-lap block, two minutes in the pits and back out is one
 * window on the race loop and two on the practice loop, and only the window says so.
 */

/** Official = a race/heat result (has the field, the finishing order). Practice = a lap feed. */
export type OutingKind = "official" | "practice";

/** Which end of the session a source's stored time marks. */
export type TimeAnchor = "start" | "end";

export type Span = { start: Date; end: Date };

/** Parser ids as the importers stamp them (`src/lib/lapUrlParsers`, `src/lib/speedhive`). */
const SPEEDHIVE_RESULTS_PARSER = "speedhive_api_v1";

export function outingKindFor(
  parserId: string | null | undefined,
  sourceUrl: string | null | undefined,
): OutingKind {
  const p = (parserId ?? "").toLowerCase();
  if (p.includes("practice")) return "practice";
  if (p.includes("race_result") || p === SPEEDHIVE_RESULTS_PARSER || p.includes("myrcm")) return "official";
  const u = (sourceUrl ?? "").toLowerCase();
  if (!u) return "official";
  if (parseSpeedhivePracticeActivityRef(u)) return "practice";
  if (u.includes("view_session") || u.includes("practice")) return "practice";
  return "official";
}

/**
 * Speedhive race results stamp the LAST crossing (`speedhiveSessionLaps.ts`); every other source
 * stamps when the session started (Speedhive practice: first lap; LiveRC: the page's "on … at").
 */
export function timeAnchorFor(
  parserId: string | null | undefined,
  sourceUrl: string | null | undefined,
): TimeAnchor {
  const p = (parserId ?? "").toLowerCase();
  if (p) return p === SPEEDHIVE_RESULTS_PARSER ? "end" : "start";
  const u = (sourceUrl ?? "").toLowerCase();
  if (/speedhive|mylaps|sporthive/.test(u) && !parseSpeedhivePracticeActivityRef(u)) return "end";
  return "start";
}

export function spanFrom(instant: Date, durationSeconds: number, anchor: TimeAnchor): Span {
  const ms = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 0) * 1000;
  return anchor === "end"
    ? { start: new Date(instant.getTime() - ms), end: instant }
    : { start: instant, end: new Date(instant.getTime() + ms) };
}

/** A shared window is as long as its longest runner: the biggest lap total across drivers. */
export function durationFromDrivers(drivers: ReadonlyArray<{ laps: readonly number[] }>): number {
  let max = 0;
  for (const d of drivers) {
    let total = 0;
    for (const lap of d.laps) if (Number.isFinite(lap) && lap > 0) total += lap;
    if (total > max) max = total;
  }
  return max;
}

/**
 * Before a session is imported the sheet only knows its lap count and best lap. Laps × best with
 * a little slack is close enough to tell "same window" from "next heat"; null when either is
 * missing, and the caller treats the session as a point in time.
 */
export function estimateDurationSeconds(
  lapCount: number | null | undefined,
  bestLapSeconds: number | null | undefined,
): number | null {
  if (!lapCount || !bestLapSeconds || lapCount <= 0 || bestLapSeconds <= 0) return null;
  return lapCount * bestLapSeconds * 1.08;
}

export function spansOverlap(a: Span, b: Span): boolean {
  return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
}
