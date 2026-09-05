"use client";

import { useEffect, useState } from "react";
import type { CompareRunShape } from "@/components/runs/RunComparePanel";
import { toCompareRunShape } from "@/lib/runCompareShape";

/**
 * Every run the viewer logged at one venue, any car, for the lap-times picker.
 *
 * The picker used to see only the runs the page underneath happened to have loaded —
 * the Sessions list's first 40, sliced to the car the run was on. "This track only"
 * then showed a fraction of the track: Jordan's 17 May runs at Bayside were on the
 * A800R and his June ones on the A800RR, and neither month could see the other
 * (reported 2026-09-05). Laps are laps; the car rides the row's second line.
 *
 * Rows arrive without a timing-sheet field (`importedLapSets`), so a run the page
 * already holds should win the merge — the page's copy carries the Field tab.
 */
export function useRunsAtTrackForPicker(input: {
  enabled: boolean;
  trackName: string | null;
}): CompareRunShape[] {
  const { enabled, trackName } = input;
  const [runs, setRuns] = useState<CompareRunShape[]>([]);

  useEffect(() => {
    const name = trackName?.trim();
    if (!enabled || !name) {
      setRuns([]);
      return;
    }
    let alive = true;
    fetch(`/api/runs/for-picker?track=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: { runs?: Array<Parameters<typeof toCompareRunShape>[0]> } | null) => {
        if (!alive || !data?.runs) return;
        setRuns(data.runs.map(toCompareRunShape));
      });
    return () => {
      alive = false;
    };
  }, [enabled, trackName]);

  return runs;
}
