/**
 * Correcting how many runs are on a set of tires, and carrying that correction
 * forward.
 *
 * ============================== WHY THIS EXISTS ==============================
 *
 * `tireRunNumber` is not a fact about one run — it is a position in a sequence.
 * Run #4 on a set only means anything because #3 came before it and #5 comes
 * after. So a driver who logs a session, then realises the set already had two
 * runs on it, is not correcting one number: every later run on that same rubber
 * is out by the same two.
 *
 * `tireStintId` is what makes "that same rubber" answerable. Runs sharing a
 * stint are one life of rubber; the moment a different set goes on, the stint
 * changes, so a cascade that stops at the stint boundary stops exactly where
 * the driver's correction stops applying. Nothing needs to look for the change
 * of tires — it is already in the data.
 *
 * ============================== WHY A SHIFT, NOT A RENUMBER ==============================
 *
 * Later runs move by the same delta rather than being renumbered 1..N. A stint
 * is not guaranteed to be gapless: an "age unknown" set counts from when the
 * driver got it, runs get logged out of order, and a driver may have already
 * hand-fixed part of the sequence. Shifting preserves whatever spacing is
 * there; renumbering would silently invent a sequence nobody entered.
 *
 * The floor of 1 is the schema's (`tireRunNumber Int @default(1)`, 1 = first
 * run on the rubber). A downward correction big enough to push a later run
 * below 1 clamps instead of going negative, which does compress the spacing —
 * accepted, because the alternative is a number that means nothing.
 */

import type { SetupSnapshotData } from "@/lib/runSetup";
import { isTireFieldKey, normalizeTireSelectionFromUnknown } from "@/lib/tires/tireSelectionValue";

/** A run further down the same stint than the one being edited. */
export type StintRunForCascade = {
  id: string;
  tireRunNumber: number;
  setupSnapshotId: string | null;
};

export type TireRunNumberCascadeStep = {
  runId: string;
  setupSnapshotId: string | null;
  tireRunNumber: number;
};

/**
 * The rows a correction of `delta` has to move. Runs already carrying the right
 * number (only reachable via the clamp) are dropped, so an empty plan means
 * there is genuinely nothing to write.
 */
export function planTireRunNumberCascade(
  delta: number,
  laterRuns: readonly StintRunForCascade[]
): TireRunNumberCascadeStep[] {
  if (!Number.isFinite(delta) || delta === 0) return [];
  const steps: TireRunNumberCascadeStep[] = [];
  for (const run of laterRuns) {
    const current = Math.max(1, Math.floor(run.tireRunNumber) || 1);
    const next = Math.max(1, current + Math.floor(delta));
    if (next === run.tireRunNumber) continue;
    steps.push({ runId: run.id, setupSnapshotId: run.setupSnapshotId, tireRunNumber: next });
  }
  return steps;
}

/**
 * The same number lives twice: on the `Run` row, and inside the setup snapshot's
 * `tires` value, which is what the setup sheet and any PDF export render. Moving
 * one without the other leaves the sheet reading "run 4" under a run the app
 * calls run 6.
 *
 * Returns null when there is nothing to change, so callers can skip the write.
 */
export function withTireRunNumberInSnapshot(
  data: unknown,
  tireRunNumber: number
): SetupSnapshotData | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const source = data as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(source)) {
    if (!isTireFieldKey(key)) continue;
    const tire = normalizeTireSelectionFromUnknown(value);
    if (!tire) continue;
    if (tire.tireRunNumber === tireRunNumber) continue;
    next = next ?? { ...source };
    next[key] = { ...tire, tireRunNumber };
  }
  return (next as SetupSnapshotData | null) ?? null;
}
