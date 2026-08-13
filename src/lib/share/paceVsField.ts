import "server-only";

import {
  computeFieldSheet,
  lapRowsFromTimesAndFlags,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { loadRaceFieldForRun } from "@/lib/lapImport/raceFieldForRun";

/**
 * Seconds per lap between this driver and the field's average pace.
 *
 * Sign follows the repo convention — user minus field, so **negative is faster**. `pace` is the
 * mean of a driver's ten fastest included laps, the same metric the field sheet and the Engineer
 * already rank on, so a shared card can never disagree with the screen it came from.
 *
 * The two sides of the field are built differently on purpose, copied from `RunRaceFieldSwitcher`:
 * your row comes from your own run (carrying your manual lap exclusions), competitors' rows come
 * from the imported payload through the median-band heuristic, because their laps can't be
 * inspected. Build your row from the payload instead and your own number stops matching your
 * stat wells the moment you edit a lap.
 *
 * Null whenever there is no honest comparison: no linked timing session, fewer than two drivers,
 * or too few ranked drivers to average over.
 */
export async function paceVsFieldSecondsForRun(
  viewerId: string,
  runId: string,
  run: { lapTimes: unknown; lapSession?: unknown }
): Promise<number | null> {
  const field = await loadRaceFieldForRun(viewerId, runId);
  if (field.drivers.length < 2) return null;

  const userRows = primaryLapRowsFromRun(run);
  const sheet = computeFieldSheet(
    field.drivers.map((d) => ({
      id: d.id,
      name: d.name,
      position: d.position,
      isUser: d.isUser,
      rows:
        d.isUser && userRows.length > 0
          ? userRows
          : applyMedianBandAutoExclude(lapRowsFromTimesAndFlags(d.laps)),
    }))
  );

  const mine = sheet.you?.pace;
  const theirs = sheet.averages.avgTop10;
  if (mine == null || theirs == null) return null;
  if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return null;
  return mine - theirs;
}
