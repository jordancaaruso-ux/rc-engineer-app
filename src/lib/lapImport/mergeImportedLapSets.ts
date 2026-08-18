/**
 * Joining a driver's lap sets across the timing imports attached to one run.
 *
 * A run may hold more than one `ImportedLapTimeSession` — a session split by a
 * quick break comes back from the timing site as two entries. Each import
 * persists a `RunImportedLapSet` per driver in that heat, so the same rival (and
 * the driver themself) legitimately owns one set per import. Screens that list
 * one row per driver must join those first or the field reads twice.
 *
 * The stored rows are deliberately left per-import — provenance (`sourceUrl`,
 * `sessionCompletedAt`) is worth keeping, and the run edit form rebuilds each
 * import's per-lap ticks from its own sets. So the join happens on read.
 *
 * With a single import attached, every group has one member and each set is
 * returned by reference — the merge is inert on the standard flow by
 * construction, not by luck.
 */

export type MergeableLapSetLap = {
  lapNumber: number;
  lapTimeSeconds: number;
  isIncluded: boolean;
};

export type MergeableLapSet = {
  driverName: string;
  normalizedName?: string | null;
  isPrimaryUser: boolean;
  sessionCompletedAt?: Date | string | null;
  createdAt?: Date | string | null;
  laps: MergeableLapSetLap[];
};

/** Cross-import identity. Driver ids are minted per session, so the name is the only stable key. */
function driverKey(set: MergeableLapSet): string {
  const norm = set.normalizedName?.trim().toLowerCase();
  if (norm) return norm;
  return set.driverName.trim().toLowerCase();
}

/** Earliest on-track time, falling back to when the row was written. Unknown sorts last. */
function orderStamp(set: MergeableLapSet): number {
  const raw = set.sessionCompletedAt ?? set.createdAt ?? null;
  if (raw == null) return Number.POSITIVE_INFINITY;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * One set per driver, laps concatenated in on-track order and renumbered from 1.
 *
 * Renumbering matters: every import numbers its own laps from 1, and
 * `getIncludedLaps` drops lap 0, so a naive concatenation would both collide and
 * silently lose a lap. Per-lap `isIncluded` flags ride along unchanged, so a lap
 * the driver excluded in one half stays excluded in the join.
 *
 * The surviving row keeps the earliest set's identity and provenance;
 * `isPrimaryUser` is true when it was true on any half.
 */
export function mergeImportedLapSetsByDriver<T extends MergeableLapSet>(
  sets: readonly T[]
): T[] {
  if (sets.length < 2) return [...sets];

  const groups = new Map<string, T[]>();
  for (const set of sets) {
    const key = driverKey(set);
    const bucket = groups.get(key);
    if (bucket) bucket.push(set);
    else groups.set(key, [set]);
  }

  const out: T[] = [];
  for (const bucket of groups.values()) {
    // Untouched — and the same object — whenever a driver only appears once.
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }

    const ordered = [...bucket].sort((a, b) => orderStamp(a) - orderStamp(b));
    const laps: MergeableLapSetLap[] = [];
    for (const set of ordered) {
      for (const lap of set.laps) {
        laps.push({
          lapNumber: laps.length + 1,
          lapTimeSeconds: lap.lapTimeSeconds,
          isIncluded: lap.isIncluded,
        });
      }
    }

    out.push({
      ...ordered[0]!,
      isPrimaryUser: ordered.some((s) => s.isPrimaryUser),
      laps,
    });
  }

  return out;
}
