import { normalizeLiveRcTrackOrigin } from "@/lib/lapWatch/liveRcTrackUrl";
import { localTodayYmd, defaultEventDatesForLiveRcDetection } from "@/lib/lapWatch/liveRcMeetingDates";

export { localTodayYmd, defaultEventDatesForLiveRcDetection } from "@/lib/lapWatch/liveRcMeetingDates";

/** Canonical LiveRC event hub URL for dedupe (view_event links). */
export function normalizeLiveRcEventHubUrl(urlStr: string): string | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!/\.liverc\.com$/i.test(u.hostname)) return null;
    const id = u.searchParams.get("id")?.trim();
    const p = (u.searchParams.get("p") ?? "").toLowerCase();
    if (p !== "view_event" || !id) {
      return u.toString();
    }
    u.hash = "";
    u.search = `?p=view_event&id=${encodeURIComponent(id)}`;
    return u.toString();
  } catch {
    return null;
  }
}

export function defaultEventNameFromLiveRcLabel(
  eventLabel: string | null | undefined,
  trackName?: string | null
): string {
  const label = eventLabel?.trim();
  if (label && !/view current event/i.test(label)) return label;
  if (trackName?.trim()) return `${trackName.trim()} event`;
  return "Event";
}

export type LiveRcMeetingDetectionPayload = {
  detected: true;
  eventLabel: string;
  eventHubUrl: string;
  trackOrigin: string | null;
  matchedEventId: string | null;
  /**
   * Name of the existing event the driver is about to be put on, when there is one.
   *
   * `eventLabel` is LiveRC's name for the meeting; this is the name of the row in our database,
   * and the two are often different — the prompt used to show only the former while applying the
   * latter, so a driver agreed to "2026 Winter Series Rd 4" and landed on "sat bash".
   */
  matchedEventName: string | null;
  /** Teammate who owns the matched event. Null when it is the viewer's own, or a stranger's. */
  matchedEventOwnerName: string | null;
};

export function buildLiveRcMeetingDetectionPayload(input: {
  eventLabel: string | null;
  eventHubUrl: string;
  trackLiveRcUrl: string;
  matchedEventId?: string | null;
  matchedEventName?: string | null;
  matchedEventOwnerName?: string | null;
}): LiveRcMeetingDetectionPayload | null {
  const eventHubUrl = normalizeLiveRcEventHubUrl(input.eventHubUrl);
  if (!eventHubUrl) return null;
  const trackOrigin = normalizeLiveRcTrackOrigin(input.trackLiveRcUrl);
  const eventLabel =
    input.eventLabel?.trim() && !/view current event/i.test(input.eventLabel)
      ? input.eventLabel.trim()
      : defaultEventNameFromLiveRcLabel(input.eventLabel, null);

  const matchedEventId = input.matchedEventId?.trim() || null;

  return {
    detected: true,
    eventLabel,
    eventHubUrl,
    trackOrigin,
    matchedEventId,
    matchedEventName: matchedEventId ? input.matchedEventName?.trim() || null : null,
    matchedEventOwnerName: matchedEventId
      ? input.matchedEventOwnerName?.trim() || null
      : null,
  };
}
