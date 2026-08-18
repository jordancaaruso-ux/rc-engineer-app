/**
 * Reading the run's own laps out of the timing imports attached to it.
 *
 * A run may hold more than one import — a session split by a quick break comes
 * back from the timing site as two entries, and the driver attaches both. The
 * run still has a single lap list (`Run.lapTimes` plus the per-lap flags in
 * `lapSession`), and every number the app shows is computed from it: best lap,
 * average top 5, consistency, lap count. So the halves are joined here, once, on
 * the way to save, and nothing downstream needs to know it happened.
 *
 * With one import attached these are pass-throughs — the ordering is a no-op and
 * the join returns that block's rows renumbered from 1, which is what they
 * already were.
 */

import type { LapRow } from "@/lib/lapAnalysis";
import type { UrlImportBlock } from "@/components/runs/LapTimesIngestPanel";
import { resolveImportedSessionDisplayTimeIso } from "@/lib/lapImport/labels";

/** The on-track instant a block should sort by — payload time, else the persisted one, else import time. */
export function blockTrackTimeIso(block: UrlImportBlock): string {
  const parsedPayload =
    block.sessionCompletedAtIso != null && block.sessionCompletedAtIso.trim()
      ? { sessionCompletedAtIso: block.sessionCompletedAtIso.trim() }
      : undefined;
  return resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt: block.sessionCompletedAtDbIso ?? null,
    parsedPayload,
    createdAt: block.recordedAt,
  });
}

/**
 * Blocks in the order the driver was actually on track.
 *
 * Load-bearing beyond tidiness: the first block is the run's primary import, and
 * restored blocks come back from the edit form newest-first. Without this, an
 * edit round-trip would quietly promote the second half to first.
 */
export function orderBlocksByTrackTime(blocks: readonly UrlImportBlock[]): UrlImportBlock[] {
  return [...blocks].sort((a, b) => {
    const at = new Date(blockTrackTimeIso(a)).getTime();
    const bt = new Date(blockTrackTimeIso(b)).getTime();
    if (Number.isNaN(at) || Number.isNaN(bt) || at === bt) return 0;
    return at - bt;
  });
}

/** The driver the block's laps belong to: first selected, else nothing. */
export function primaryDriverForBlock(block: UrlImportBlock) {
  const selected = new Set(block.selectedDriverIds ?? []);
  const ordered = (block.sessionDrivers ?? []).filter((d) => selected.has(d.driverId));
  return ordered[0] ?? null;
}

/** One block's primary rows, preferring the edited per-lap state over the raw parse. */
export function primaryRowsForBlock(block: UrlImportBlock): LapRow[] {
  const primary = primaryDriverForBlock(block);
  if (!primary) return [];
  const rows = block.driverLapRowsByDriverId?.[primary.driverId];
  if (rows && rows.length > 0) return rows.map((r) => ({ ...r }));
  return primary.laps.map((t, i) => ({
    lapNumber: i + 1,
    lapTimeSeconds: t,
    isIncluded: true,
  }));
}

/**
 * Every attached import's primary rows, joined in on-track order and renumbered
 * from 1.
 *
 * Renumbering is required, not cosmetic: each import numbers its own laps from
 * 1, and `getIncludedLaps` drops lap 0, so a raw concatenation would collide and
 * lose laps from the metrics.
 */
export function primaryRowsAcrossBlocks(blocks: readonly UrlImportBlock[]): LapRow[] {
  const out: LapRow[] = [];
  for (const block of orderBlocksByTrackTime(blocks)) {
    for (const row of primaryRowsForBlock(block)) {
      out.push({
        lapNumber: out.length + 1,
        lapTimeSeconds: row.lapTimeSeconds,
        isIncluded: row.isIncluded,
      });
    }
  }
  return out;
}

export type BlockPerLapMeta = {
  isOutlierWarning?: boolean;
  warningReason?: string | null;
  isFlagged: boolean;
  flagReason?: string | null;
  isIncluded: boolean;
};

/**
 * Per-lap flags for the joined lap list, in the same order as
 * `primaryRowsAcrossBlocks`.
 *
 * Import warnings live on each block's own `urlLapRows`, so they are read
 * per-block rather than from the form-level array — that one only ever holds the
 * most recent import, and indexing a joined list into it would hang the first
 * half's warnings on the second half's laps.
 */
export function primaryPerLapAcrossBlocks(blocks: readonly UrlImportBlock[]): BlockPerLapMeta[] {
  const out: BlockPerLapMeta[] = [];
  for (const block of orderBlocksByTrackTime(blocks)) {
    const rows = primaryRowsForBlock(block);
    const warnings = block.urlLapRows ?? null;
    const aligned = warnings && warnings.length === rows.length ? warnings : null;
    rows.forEach((row, i) => {
      const w = aligned?.[i];
      out.push({
        isOutlierWarning: w?.isOutlierWarning,
        warningReason: w?.warningReason ?? null,
        isFlagged: Boolean(w?.isFlagged),
        flagReason: w?.flagReason ?? null,
        isIncluded: row.isIncluded,
      });
    });
  }
  return out;
}

/** Lap index where each block after the first begins — the joins, for marking a break in lap views. */
export function blockJoinLapNumbers(blocks: readonly UrlImportBlock[]): number[] {
  const joins: number[] = [];
  let count = 0;
  for (const block of orderBlocksByTrackTime(blocks)) {
    const added = primaryRowsForBlock(block).length;
    // A block with no selected driver contributes no laps, so it marks no break —
    // counting it would point a join past the end of the list.
    if (added === 0) continue;
    if (count > 0) joins.push(count + 1);
    count += added;
  }
  return joins;
}
