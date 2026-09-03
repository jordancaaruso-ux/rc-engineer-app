/**
 * Run candidates for the Engineer's subject bar — pure shaping/sorting/filtering. The API route
 * (`/api/engineer/run-candidates`) returns raw rows; the client maps them through these builders
 * so "Today / Yesterday" labels use the device's local calendar, same as every other run picker.
 *
 * Runs only. The 2026-07-30 bar could also pin a saved setup or an event and build a compare
 * pair; the rebuilt Engineer reads a RUN (its setup, its day, the runs before it —
 * `driverData.ts`) and nothing else, so nothing else is offered (founder call 2026-09-03: every
 * state the bar can show is something the Engineer actually does).
 */

import {
  formatRunPickerSessionSegment,
  formatRunPickerWhenSegment,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import { formatLap } from "@/lib/runLaps";

export type RunCandidate = {
  id: string;
  /** Row primary text, e.g. "Today · Qualifying Q2". */
  label: string;
  /** Row secondary text, e.g. "Keilor — 14.203". */
  sublabel: string | null;
  /**
   * Short text for the subject bar. Car identity is always present — pinning exists because
   * multi-car days make "latest run" ambiguous.
   */
  chipLabel: string;
  carId: string | null;
  carName: string | null;
  /** Sort axis, newest first. */
  sortIso: string;
};

/** The lean row the route returns — a `RunPickerRun` plus the fields the labels read. */
export type RunCandidateRow = RunPickerRun & {
  sortAt?: Date | string | null;
  sessionCompletedAt?: Date | string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  track?: { name: string } | null;
  bestLapSeconds?: number | null;
};

function joinPresent(parts: Array<string | null | undefined>, sep: string): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

export function buildRunCandidate(run: RunCandidateRow): RunCandidate {
  const when = formatRunPickerWhenSegment(run);
  const session = formatRunPickerSessionSegment(run);
  const carName = run.car?.name ?? run.carNameSnapshot ?? null;
  const track = run.track?.name ?? run.trackNameSnapshot ?? null;
  const best = run.bestLapSeconds != null ? formatLap(run.bestLapSeconds) : null;
  const sortSource = run.sortAt ?? run.sessionCompletedAt ?? run.createdAt;
  return {
    id: run.id,
    label: joinPresent([when, session], " · "),
    sublabel: joinPresent([track, best], " — ") || null,
    chipLabel: joinPresent([when, session, carName], " · "),
    carId: run.carId ?? null,
    carName,
    sortIso: new Date(sortSource).toISOString(),
  };
}

/** Newest first; caps the list. */
export function sortCandidates(items: RunCandidate[], cap = 80): RunCandidate[] {
  return [...items]
    .sort((a, b) => (a.sortIso < b.sortIso ? 1 : a.sortIso > b.sortIso ? -1 : 0))
    .slice(0, cap);
}

/** Case-insensitive substring match over label, sublabel and car name. */
export function filterCandidates(items: RunCandidate[], query: string): RunCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((c) =>
    [c.label, c.sublabel, c.carName].some((s) => s?.toLowerCase().includes(q))
  );
}

/** Distinct cars among candidates, for the picker's car-filter row (shown at 2+). */
export function distinctCandidateCars(
  items: RunCandidate[]
): Array<{ carId: string; carName: string }> {
  const seen = new Map<string, string>();
  for (const c of items) {
    if (c.carId && c.carName && !seen.has(c.carId)) seen.set(c.carId, c.carName);
  }
  return [...seen.entries()].map(([carId, carName]) => ({ carId, carName }));
}
