import { validateTimingHttpUrlSync } from "@/lib/http/timingUrlSafetySync";
import { isSpeedhiveHostname } from "@/lib/speedhive/speedhiveUrl";

export type ParsedSpeedhivePracticeActivityRef = {
  locationId: number;
  activityId: number;
  sessionUrl: string;
};

/** Parse practice track location id from URLs like https://speedhive.mylaps.com/practice/4591 */
export function parseSpeedhivePracticeLocationId(urlStr: string): number | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!isSpeedhiveHostname(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, "");
    const hash = u.hash.replace(/^#\/?/, "");
    const combined = `${path}/${hash}`;
    const patterns = [/\/practice\/(\d+)/i, /practice\/(\d+)/i];
    for (const re of patterns) {
      const m = combined.match(re);
      if (m?.[1]) {
        const id = Number(m[1]);
        if (Number.isFinite(id) && id > 0) return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function buildSpeedhivePracticeActivityUrl(
  locationId: number,
  activityId: number
): string {
  return `https://speedhive.mylaps.com/practice/${locationId}/activities/${activityId}`;
}

export function parseSpeedhivePracticeActivityRef(
  urlStr: string
): ParsedSpeedhivePracticeActivityRef | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (!isSpeedhiveHostname(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, "");
    const m =
      path.match(/\/practice\/(\d+)\/activities\/(\d+)/i) ??
      path.match(/\/practice\/(\d+)\/activity\/(\d+)/i);
    if (!m?.[1] || !m[2]) return null;
    const locationId = Number(m[1]);
    const activityId = Number(m[2]);
    if (!Number.isFinite(locationId) || locationId <= 0) return null;
    if (!Number.isFinite(activityId) || activityId <= 0) return null;
    return {
      locationId,
      activityId,
      sessionUrl: buildSpeedhivePracticeActivityUrl(locationId, activityId),
    };
  } catch {
    return null;
  }
}

export function practiceLocationIdFromTrackUrl(
  speedhiveUrl: string | null | undefined
): number | null {
  if (!speedhiveUrl?.trim()) return null;
  return parseSpeedhivePracticeLocationId(speedhiveUrl);
}
