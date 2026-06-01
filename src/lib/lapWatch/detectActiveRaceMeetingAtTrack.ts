import "server-only";

import { fetchLiveRcDashboard } from "@/lib/lapWatch/resolveLiveRcIndexUrl";
import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";

export type ActiveRaceMeetingResult = {
  detected: boolean;
  eventHubUrl: string | null;
  eventLabel: string | null;
};

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Best-effort: LiveRC dashboard shows a current event and reference date is today (local).
 * Does not mutate run type — metadata for optional event-link UI only.
 */
export async function detectActiveRaceMeetingAtTrack(input: {
  trackLiveRcUrl: string;
  referenceDate?: Date;
}): Promise<ActiveRaceMeetingResult> {
  const origin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  if (!origin) {
    return { detected: false, eventHubUrl: null, eventLabel: null };
  }

  const dash = await fetchLiveRcDashboard(origin);
  if (!dash.ok || !dash.parsed.currentEventHubUrl) {
    return { detected: false, eventHubUrl: null, eventLabel: null };
  }

  const ref = input.referenceDate ?? new Date();
  const today = new Date();
  const detected = sameLocalCalendarDay(ref, today);

  return {
    detected,
    eventHubUrl: dash.parsed.currentEventHubUrl,
    eventLabel: dash.parsed.currentEventLabel,
  };
}
