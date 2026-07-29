/**
 * Anchor picker candidates — pure shaping/sorting/filtering for the Engineer's
 * attach picker and focus chip. The API route returns raw rows; the client maps
 * them through these builders so "Today / Yesterday" labels use the device's
 * local calendar, same as every other run picker.
 */

import {
  formatRunPickerSessionSegment,
  formatRunPickerWhenSegment,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import { formatLap } from "@/lib/runLaps";
import type { EngineerAnchorKind } from "@/lib/engineerPhase5/engineerAnchor";

export type AnchorCandidate = {
  kind: EngineerAnchorKind;
  id: string;
  /** Row primary text, e.g. "Today · Qualifying Q2". */
  label: string;
  /** Row secondary text, e.g. "Keilor — 14.203". */
  sublabel: string | null;
  /**
   * Short text for the focus chip. Car identity is always present — anchoring
   * exists because multi-car days make "latest run" ambiguous.
   */
  chipLabel: string;
  carId: string | null;
  carName: string | null;
  /** Merge/sort axis, newest first. */
  sortIso: string;
};

function joinPresent(parts: Array<string | null | undefined>, sep: string): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(sep);
}

export function buildRunAnchorCandidate(
  run: RunPickerRun & { id: string; sortAt?: Date | string | null }
): AnchorCandidate {
  const when = formatRunPickerWhenSegment(run);
  const session = formatRunPickerSessionSegment(run);
  const carName = run.car?.name ?? run.carNameSnapshot ?? null;
  const track = run.track?.name ?? run.trackNameSnapshot ?? null;
  const best = run.bestLapSeconds != null ? formatLap(run.bestLapSeconds) : null;
  const sortSource = run.sortAt ?? run.sessionCompletedAt ?? run.createdAt;
  return {
    kind: "run",
    id: run.id,
    label: joinPresent([when, session], " · "),
    sublabel: joinPresent([track, best], " — ") || null,
    chipLabel: joinPresent([when, session, carName], " · "),
    carId: run.carId ?? null,
    carName,
    sortIso: new Date(sortSource).toISOString(),
  };
}

export function buildSetupAnchorCandidate(setup: {
  id: string;
  name: string | null;
  createdAt: Date | string;
  carId?: string | null;
  car?: { name: string } | null;
}): AnchorCandidate {
  const name = setup.name?.trim() || "Saved setup";
  const carName = setup.car?.name ?? null;
  return {
    kind: "setup",
    id: setup.id,
    label: name,
    sublabel: carName,
    chipLabel: joinPresent([name, carName], " · "),
    carId: setup.carId ?? null,
    carName,
    sortIso: new Date(setup.createdAt).toISOString(),
  };
}

export function buildEventAnchorCandidate(event: {
  id: string;
  name: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  trackNameSnapshot?: string | null;
  track?: { name: string } | null;
}): AnchorCandidate {
  const trackName = event.track?.name ?? event.trackNameSnapshot ?? null;
  return {
    kind: "event",
    id: event.id,
    label: event.name,
    sublabel: trackName,
    // Events span cars — the meeting name + track is the identity here.
    chipLabel: joinPresent([event.name, trackName], " · "),
    carId: null,
    carName: null,
    sortIso: new Date(event.endDate ?? event.startDate).toISOString(),
  };
}

/** Newest first across every kind; caps the merged list. */
export function mergeAndSortCandidates(
  lists: AnchorCandidate[][],
  cap = 80
): AnchorCandidate[] {
  return lists
    .flat()
    .sort((a, b) => (a.sortIso < b.sortIso ? 1 : a.sortIso > b.sortIso ? -1 : 0))
    .slice(0, cap);
}

/** Case-insensitive substring match over label, sublabel and car name. */
export function filterCandidates(items: AnchorCandidate[], query: string): AnchorCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((c) =>
    [c.label, c.sublabel, c.carName].some((s) => s?.toLowerCase().includes(q))
  );
}

/** Distinct cars among candidates, for the picker's car-filter row (shown at 2+). */
export function distinctCandidateCars(
  items: AnchorCandidate[]
): Array<{ carId: string; carName: string }> {
  const seen = new Map<string, string>();
  for (const c of items) {
    if (c.carId && c.carName && !seen.has(c.carId)) seen.set(c.carId, c.carName);
  }
  return [...seen.entries()].map(([carId, carName]) => ({ carId, carName }));
}
