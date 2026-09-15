/**
 * The crossings a traced lap is pinned to, out of the session.
 *
 * The crossing scan already put each corner on the video clock and, for a crossing it found
 * itself, kept where in the frame the car was (`ManualScanCandidate.x/y`, matched to the mark by
 * its time). Those positions are the tracer's anchors. The start line is a transponder fact with
 * no stored position, and a hand mark has none either; both come back with `x`/`y` null and are
 * seeded off the footage by the runner.
 */

import { computeLapBreakdown, type SectorLineInfo } from "@/lib/manualVideoAnalysis/sectors";
import type { DriverRole, ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { SF_LINE_KEY } from "../findCrossings/fromSession";

export type LapAnchor = {
  lineKey: string;
  /** Video time of the crossing. */
  t: number;
  /** Where in the frame, video pixels of the frame the scan read; null when not known. */
  x: number | null;
  y: number | null;
  from: "detector" | "hand" | "sf";
};

export type LapAnchors = {
  startSec: number;
  endSec: number;
  lapTimeSec: number;
  /** Time order, the start line first and last. */
  anchors: LapAnchor[];
};

/** A candidate this close to the mark's time is the one the mark was written from. */
const SAME_TIME_SEC = 0.001;

export type LapAnchorOptions = {
  /**
   * Dev measurement only: leave the corner crossings out and pin the lap on the start line alone.
   *
   * The crossings a lap is normally pinned to are the very thing under test when the question is
   * whether a followed path could replace them — pinned to them, a path can only agree. Set this
   * and the tracer has one stretch from the start line to the start line, exactly the ground-up
   * design, and its crossings can be scored honestly. Never set in the product.
   */
  cornersOff?: boolean;
};

export function lapAnchors(
  session: ManualVideoSessionV2,
  lines: SectorLineInfo[],
  sessionId: string,
  role: DriverRole,
  lapNumber: number,
  opts: LapAnchorOptions = {}
): LapAnchors | null {
  const bd = computeLapBreakdown(session, lines, sessionId, role, lapNumber);
  if (!bd || bd.lapStartSec == null) return null;
  const startSec = bd.lapStartSec;
  const endSec = bd.lapEndSec ?? startSec + bd.lapTimeSec;
  const anchors: LapAnchor[] = [{ lineKey: SF_LINE_KEY, t: startSec, x: null, y: null, from: "sf" }];
  for (const s of bd.sectors) {
    if (opts.cornersOff) continue;
    if (s.lineKey === SF_LINE_KEY) continue;
    // A missing mark comes through zeroed.
    if (!(s.videoTimeSec > 0) || !(s.cumulativeSec > 0)) continue;
    const mark = session.marks.find(
      (m) =>
        m.sessionId === sessionId &&
        m.driverRole === role &&
        m.lapNumber === lapNumber &&
        m.lineKey === s.lineKey
    );
    const cand = mark?.candidates?.find(
      (c) => c.x != null && c.y != null && Math.abs(c.t - mark.videoTimeSec) <= SAME_TIME_SEC
    );
    anchors.push({
      lineKey: s.lineKey,
      t: s.videoTimeSec,
      x: cand?.x ?? null,
      y: cand?.y ?? null,
      from: mark?.source ? "detector" : "hand",
    });
  }
  anchors.push({ lineKey: SF_LINE_KEY, t: endSec, x: null, y: null, from: "sf" });
  return { startSec, endSec, lapTimeSec: bd.lapTimeSec, anchors: anchors.sort((a, b) => a.t - b.t) };
}
