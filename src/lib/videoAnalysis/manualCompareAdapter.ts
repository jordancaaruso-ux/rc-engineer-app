/**
 * Adapts a manual video session (marks + transponder laps) into the same
 * CompareCar shape the worker results produce, so manual marking feeds the
 * exact same lap-compare surface (VIDEO_ANALYSIS_REWORK Phase A).
 *
 * Split semantics match the worker's: cumulative seconds from lap start.
 * Absolute video windows come from computeLapBreakdown's lapStartSec (video
 * time of the SF crossing, marked or predicted from the sync anchor).
 */

import {
  LAP_START_LINE_KEY,
  lapSfKey,
  type ManualVideoSessionV2,
} from "@/lib/manualVideoAnalysis/types";
import {
  computeLapBreakdown,
  type SectorLineInfo,
} from "@/lib/manualVideoAnalysis/sectors";
import { participants } from "@/lib/manualVideoAnalysis/sessionModel";
import { realLaps } from "./findCrossings/fromSession";
import type { CompareCar, CompareLap } from "./lapCompare";

/**
 * Which car number a driver gets on the compare.
 *
 * "You" is always car 1 and the first rival car 2, because that is what every saved analysis and
 * the worker path already mean by those numbers. Anyone after them is numbered by their place in
 * the roster — a third and fourth driver only became possible once several practice links could
 * be added, one per person.
 */
function carIdFor(role: string, index: number): number {
  if (role === "me") return 1;
  if (role === "competitor") return 2;
  return index + 1;
}

const ME_CAR_ID = 1;

export function compareCarsFromManualSession(
  session: ManualVideoSessionV2,
  sectorLines: SectorLineInfo[]
): CompareCar[] {
  const roster = participants(session);
  if (roster.length === 0) return [];

  const cars: CompareCar[] = [];
  // Everyone on the video, each read against the timing session their own laps came from — one
  // shared session off a race link, one apiece off practice links.
  for (const [index, { role, sessionId, timingSession: primary, driver }] of roster.entries()) {
    const carId = carIdFor(role, index);
    const carLabel = role === "me" ? "You" : driver.driverName?.trim() || "Competitor";

    // Without an anchor, predicted lap starts are raw transponder offsets, not
    // video times (predictSfStartTime falls back to transponderSfStartSec) —
    // only laps with an explicit mark/override are trustworthy then.
    const anchored = Boolean(primary.sync.anchor || primary.sync.anchorByRole?.[role]);

    const laps: CompareLap[] = [];
    // A race's opening "lap" is the run from the grid to the line — 1.7s against a 17s median
    // at Boronia — and with it in, the compare opened on "L1 BEST 1.663 vs L10". Same rule as
    // the crossing scan: a lap under 60% of the driver's median is not a lap.
    for (const lap of realLaps(driver.laps)) {
      if (lap.isIncluded === false) continue;
      if (!(lap.lapTimeSec > 0)) continue;
      const hasExplicitStart =
        session.marks.some(
          (m) =>
            m.sessionId === sessionId &&
            m.driverRole === role &&
            m.lapNumber === lap.lapNumber &&
            m.lineKey === LAP_START_LINE_KEY
        ) || primary.sync.perLapSfStart?.[lapSfKey(role, lap.lapNumber)] != null;
      if (!anchored && !hasExplicitStart) continue;
      const bd = computeLapBreakdown(session, sectorLines, sessionId, role, lap.lapNumber);
      // Without a video time for the lap start there is nothing to compare
      // (no splits are anchorable, no clip windows derivable).
      if (!bd || bd.lapStartSec == null) continue;

      const splits: Record<string, number> = {};
      for (const s of bd.sectors) {
        // Final SF crossing is the lap end, not an intermediate split; a zeroed
        // splitSec means the mark is missing for that line on this lap.
        if (s.lineKey === "sf") continue;
        if (s.splitSec > 0 && s.cumulativeSec > 0 && s.cumulativeSec < lap.lapTimeSec) {
          splits[s.lineKey] = s.cumulativeSec;
        }
      }

      laps.push({
        carId,
        carLabel,
        lapIndex: lap.lapNumber,
        lapTimeSec: lap.lapTimeSec,
        startSec: bd.lapStartSec,
        endSec: bd.lapEndSec ?? bd.lapStartSec + lap.lapTimeSec,
        splits,
      });
    }

    if (laps.length > 0) {
      cars.push({
        carId,
        carLabel,
        lapCount: laps.length,
        bestLapSec: Math.min(...laps.map((l) => l.lapTimeSec)),
        laps: laps.sort((x, y) => x.lapIndex - y.lapIndex),
      });
    }
  }

  // "You" first when present, else most laps first — same primary heuristic
  // the worker path uses.
  return cars.sort((x, y) =>
    x.carId === ME_CAR_ID ? -1 : y.carId === ME_CAR_ID ? 1 : y.lapCount - x.lapCount
  );
}
