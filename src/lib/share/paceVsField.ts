import "server-only";

import {
  computeFieldSheet,
  lapRowsFromTimesAndFlags,
  primaryLapRowsFromRun,
} from "@/lib/lapAnalysis";
import { applyMedianBandAutoExclude } from "@/lib/lapImport/autoExcludeOutlierLaps";
import { loadRaceFieldForRun } from "@/lib/lapImport/raceFieldForRun";

/**
 * Where a run sits in its race: finishing place, and pace against the field.
 *
 * Pace sign follows the repo convention — user minus field, so **negative is faster**. `pace` is
 * the mean of a driver's ten fastest included laps, the same metric the field sheet and the
 * Engineer already rank on, so a shared picture can never disagree with the screen it came from.
 *
 * The two sides of the field are built differently on purpose, copied from `RunRaceFieldSwitcher`:
 * your row comes from your own run (carrying your manual lap exclusions), competitors' rows come
 * from the imported payload through the median-band heuristic, because their laps can't be
 * inspected. Build your row from the payload instead and your own number stops matching your
 * stat wells the moment you edit a lap.
 *
 * `position` is the timing sheet's classification (most laps, then lowest total time), the order
 * `loadRaceFieldForRun` reconstructs. Penalties applied after the race are not on the sheet. The
 * founder picked finish order over fastest-lap rank for the story, practice included (share
 * interview round 2, 2026-09-25).
 */
export type RaceFieldSummary = {
  /** 1-based classification place. */
  position: number;
  fieldSize: number;
  /** Seconds a lap, you minus the field's average. Null when there is too little to average. */
  paceVsField: number | null;
  /** The field's average pace in seconds (the mean of each ranked driver's top-10 average). */
  fieldAveragePace: number | null;
  /** The name the timing sheet printed for you, e.g. `JORDAN CARUSO`. */
  timingName: string | null;
};

/** Null whenever there is no honest comparison: no linked timing session, or fewer than two drivers. */
export async function raceFieldSummaryForRun(
  viewerId: string,
  runId: string,
  run: { lapTimes: unknown; lapSession?: unknown }
): Promise<RaceFieldSummary | null> {
  const field = await loadRaceFieldForRun(viewerId, runId);
  if (field.drivers.length < 2) return null;
  const me = field.drivers.find((d) => d.isUser);
  if (!me) return null;

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
  const honest = mine != null && theirs != null && Number.isFinite(mine) && Number.isFinite(theirs);
  return {
    position: me.position,
    fieldSize: field.drivers.length,
    paceVsField: honest ? mine - theirs : null,
    fieldAveragePace: honest ? theirs : null,
    timingName: me.name?.trim() || null,
  };
}

/** Seconds per lap between this driver and the field's average pace (see {@link raceFieldSummaryForRun}). */
export async function paceVsFieldSecondsForRun(
  viewerId: string,
  runId: string,
  run: { lapTimes: unknown; lapSession?: unknown }
): Promise<number | null> {
  return (await raceFieldSummaryForRun(viewerId, runId, run))?.paceVsField ?? null;
}
