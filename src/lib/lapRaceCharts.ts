import { getCleanLapsInOrder, type LapRow } from "@/lib/lapAnalysis";

/**
 * The numbers behind the race charts on the lap sheet: gap to leader, position history and
 * the pace range per driver. Pure functions over the same `LapRow`s the grid draws, so a
 * chart can never disagree with the column it sits above.
 *
 * Two different questions, two different lap filters — and the difference is the whole point:
 *
 * - **Elapsed time** (gap, position) counts EVERY lap as recorded, excluded ones included. A
 *   crash lap is exactly where a gap opens; leaving it out would draw a driver who binned it
 *   as if they hadn't. The grid strikes those laps through because they are not *pace*; here
 *   they are *time*, and time happened.
 * - **Pace range** reads clean laps only (`getCleanLapsInOrder`: included, and within 25% of
 *   the driver's own best). A 36-second crash lap is not a driver's "slowest pace", it is a
 *   crash, and letting it stretch the bar is how the MyRCM report made Marc Rheinard's range
 *   read 16.6–36.1 when his driving was 16.6–19.5.
 */

export type RaceChartInput = {
  id: string;
  laps: LapRow[];
};

export type RaceProgressDriver = {
  id: string;
  /** Seconds elapsed at the end of lap n; index 0 is lap 1. Empty for a driver with no laps. */
  elapsed: number[];
  /** Seconds behind whoever was leading at the end of that lap. Index-aligned with `elapsed`. */
  gaps: number[];
  /** 1-based position at the end of that lap, among drivers who had completed it. */
  positions: number[];
  lapsCompleted: number;
};

export type RaceProgress = {
  /** The longest run in the set — the x-domain. */
  lapCount: number;
  drivers: RaceProgressDriver[];
  /**
   * True when lap 0 (the run from the start to the first crossing) was on some drivers'
   * sheets and not others', and was therefore left out of everyone's elapsed time. Mixed
   * bases would put a phantom lap's worth of gap on half the field.
   */
  lap0Dropped: boolean;
};

function inLapOrder(laps: LapRow[]): LapRow[] {
  return [...laps].filter((l) => Number.isFinite(l.lapTimeSeconds) && l.lapTimeSeconds > 0)
    .sort((a, b) => a.lapNumber - b.lapNumber);
}

/**
 * Elapsed time, gap to leader and position after every lap, for a set of drivers who ran
 * the SAME session. The caller decides what "same session" means; handing this drivers from
 * two different heats produces numbers that are arithmetic, not racing.
 *
 * Positions are among the drivers who completed that lap: a driver who stopped on lap 3 has
 * three positions and then no line, and everyone behind them moves up from lap 4 — which is
 * what the timing screen showed at the time. Ties fall to input order, which callers pass in
 * classification order.
 */
export function buildRaceProgress(inputs: RaceChartInput[]): RaceProgress {
  const ordered = inputs.map((d) => ({ id: d.id, laps: inLapOrder(d.laps) }));
  const withLaps = ordered.filter((d) => d.laps.length > 0);
  const hasLap0 = withLaps.map((d) => d.laps.some((l) => l.lapNumber === 0));
  const everyoneHasLap0 = withLaps.length > 0 && hasLap0.every(Boolean);
  const lap0Dropped = hasLap0.some(Boolean) && !everyoneHasLap0;

  const elapsedById = new Map<string, number[]>();
  for (const d of ordered) {
    const counted = everyoneHasLap0 ? d.laps : d.laps.filter((l) => l.lapNumber !== 0);
    const elapsed: number[] = [];
    let total = 0;
    let lapIndex = 0;
    for (const lap of counted) {
      total += lap.lapTimeSeconds;
      // Lap 0, when counted, is run-in time: it lands in the total but is not a lap of its own.
      if (lap.lapNumber === 0) continue;
      elapsed[lapIndex] = total;
      lapIndex += 1;
    }
    elapsedById.set(d.id, elapsed);
  }

  const lapCount = Math.max(0, ...ordered.map((d) => elapsedById.get(d.id)?.length ?? 0));
  const gapsById = new Map<string, number[]>(ordered.map((d) => [d.id, []]));
  const positionsById = new Map<string, number[]>(ordered.map((d) => [d.id, []]));

  for (let n = 0; n < lapCount; n += 1) {
    const running = ordered
      .map((d, order) => ({ id: d.id, t: elapsedById.get(d.id)?.[n], order }))
      .filter((r): r is { id: string; t: number; order: number } => r.t != null)
      .sort((a, b) => a.t - b.t || a.order - b.order);
    const leader = running[0]?.t ?? 0;
    running.forEach((r, i) => {
      gapsById.get(r.id)!.push(r.t - leader);
      positionsById.get(r.id)!.push(i + 1);
    });
  }

  return {
    lapCount,
    lap0Dropped,
    drivers: ordered.map((d) => {
      const elapsed = elapsedById.get(d.id) ?? [];
      return {
        id: d.id,
        elapsed,
        gaps: gapsById.get(d.id) ?? [],
        positions: positionsById.get(d.id) ?? [],
        lapsCompleted: elapsed.length,
      };
    }),
  };
}

/** Fewer clean laps than this and a driver's range is shown but not ranked. */
export const MIN_CLEAN_LAPS_FOR_PACE_RANGE = 5;

export type PaceRange = {
  id: string;
  best: number | null;
  average: number | null;
  slowest: number | null;
  /** Laps the range was read from. */
  cleanCount: number;
  /** Included laps that fell outside the clean window — crashes, marshalling, a stall. */
  offPaceCount: number;
  /** False under {@link MIN_CLEAN_LAPS_FOR_PACE_RANGE}: drawn, listed last, never ranked. */
  ranked: boolean;
};

/**
 * Best / average / slowest CLEAN lap per driver, quickest average first. Drivers with too few
 * clean laps to rank keep their input order at the bottom — a three-lap DNF with a 16.4 in it
 * is not the fastest driver in the race, whatever their average says.
 */
export function buildPaceRanges(inputs: RaceChartInput[]): PaceRange[] {
  const rows = inputs.map((d): PaceRange => {
    const clean = getCleanLapsInOrder(d.laps).map((l) => l.lapTimeSeconds);
    const includedCount = d.laps.filter(
      (l) => l.isIncluded && l.lapNumber !== 0 && l.lapTimeSeconds > 0
    ).length;
    if (clean.length === 0) {
      return {
        id: d.id,
        best: null,
        average: null,
        slowest: null,
        cleanCount: 0,
        offPaceCount: includedCount,
        ranked: false,
      };
    }
    return {
      id: d.id,
      best: Math.min(...clean),
      average: clean.reduce((a, b) => a + b, 0) / clean.length,
      slowest: Math.max(...clean),
      cleanCount: clean.length,
      offPaceCount: Math.max(0, includedCount - clean.length),
      ranked: clean.length >= MIN_CLEAN_LAPS_FOR_PACE_RANGE,
    };
  });
  const ranked = rows.filter((r) => r.ranked).sort((a, b) => a.average! - b.average!);
  const unranked = rows.filter((r) => !r.ranked);
  return [...ranked, ...unranked];
}
