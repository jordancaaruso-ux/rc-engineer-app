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
import { primaryTimingSession } from "@/lib/manualVideoAnalysis/sessionModel";
import type { CompareCar, CompareLap } from "./lapCompare";

const ROLE_CAR_IDS = { me: 1, competitor: 2 } as const;

export function compareCarsFromManualSession(
  session: ManualVideoSessionV2,
  sectorLines: SectorLineInfo[]
): CompareCar[] {
  const primary = primaryTimingSession(session);
  if (!primary) return [];

  const cars: CompareCar[] = [];
  for (const role of ["me", "competitor"] as const) {
    const driver = primary.drivers.find((d) => d.role === role);
    if (!driver) continue;
    const carId = ROLE_CAR_IDS[role];
    const carLabel = role === "me" ? "You" : driver.driverName?.trim() || "Competitor";

    // Without an anchor, predicted lap starts are raw transponder offsets, not
    // video times (predictSfStartTime falls back to transponderSfStartSec) —
    // only laps with an explicit mark/override are trustworthy then.
    const anchored = Boolean(primary.sync.anchor);

    const laps: CompareLap[] = [];
    for (const lap of driver.laps) {
      if (lap.isIncluded === false) continue;
      if (!(lap.lapTimeSec > 0)) continue;
      const hasExplicitStart =
        session.marks.some(
          (m) =>
            m.sessionId === primary.sessionId &&
            m.driverRole === role &&
            m.lapNumber === lap.lapNumber &&
            m.lineKey === LAP_START_LINE_KEY
        ) || primary.sync.perLapSfStart?.[lapSfKey(role, lap.lapNumber)] != null;
      if (!anchored && !hasExplicitStart) continue;
      const bd = computeLapBreakdown(session, sectorLines, primary.sessionId, role, lap.lapNumber);
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
    x.carId === ROLE_CAR_IDS.me ? -1 : y.carId === ROLE_CAR_IDS.me ? 1 : y.lapCount - x.lapCount
  );
}
