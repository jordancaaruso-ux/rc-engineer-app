/**
 * The timing sheet, placed on the video clock — the one fact the race pass names anything by.
 *
 * The same walk the crossing scan's field matcher uses (`AnalyzeFlowClient`'s `scanField`),
 * expressed as a pure function of the session so that a rig, a test and the app all build it the
 * same way. Two things are deliberate:
 *
 *  - **Everybody, not just the drivers with a seat.** A race import brings a whole heat. A path
 *    that turns out to be the fourth-place car has to be recognisable as *his*, or it stays in
 *    the pool competing for somebody else's slot. Naming a rival costs nothing and stops a wrong
 *    name; only seated drivers get marks and traces later.
 *  - **A session with no anchor is left out.** Nothing in it is on the video clock at all, and
 *    including it would hand the matcher lap starts derived from a clock the video has never
 *    seen — which is exactly how a wrong anchor turns into confident wrong names.
 */

import { realLaps } from "../findCrossings/fromSession";
import { predictSfStartTime } from "@/lib/manualVideoAnalysis/sync";
import { anyAnchor } from "@/lib/manualVideoAnalysis/sessionModel";
import type { DriverRole, ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { asDriverRole } from "@/lib/manualVideoAnalysis/types";
import type { SheetDriver } from "./name";

/**
 * Every driver the video's timing knows about, with each lap's start on the video clock and the
 * sheet's own duration for it.
 */
export function sheetFromSession(session: ManualVideoSessionV2): SheetDriver[] {
  const out: SheetDriver[] = [];
  for (const ts of session.timingSessions) {
    if (!ts.isOnVideo || !anyAnchor(ts.sync)) continue;
    for (const driver of ts.drivers) {
      const role = driver.role === "other" ? undefined : asDriverRole(driver.role) ?? undefined;
      const laps: SheetDriver["laps"] = [];
      for (const lap of realLaps(driver.laps)) {
        const startSec = predictSfStartTime(driver, lap.lapNumber, ts);
        if (startSec == null || !Number.isFinite(startSec)) continue;
        if (!(lap.lapTimeSec > 0)) continue;
        laps.push({ lapNumber: lap.lapNumber, startSec, lapTimeSec: lap.lapTimeSec });
      }
      if (!laps.length) continue;
      laps.sort((a, b) => a.lapNumber - b.lapNumber);
      out.push({
        key: role ?? driver.key,
        name: driver.driverName,
        ...(role ? { role } : {}),
        laps,
      });
    }
  }
  return out;
}

/** The roles with a seat in this analysis — the only ones that get marks and traces. */
export function seatedRolesOf(session: ManualVideoSessionV2): Set<DriverRole> {
  const out = new Set<DriverRole>();
  for (const ts of session.timingSessions) {
    if (!ts.isOnVideo) continue;
    for (const driver of ts.drivers) {
      const role = asDriverRole(driver.role);
      if (role) out.add(role);
    }
  }
  return out;
}
