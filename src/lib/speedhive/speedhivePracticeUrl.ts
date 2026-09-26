import { isSpeedhiveHostname } from "@/lib/speedhive/speedhiveUrl";

export type ParsedSpeedhivePracticeActivityRef = {
  /**
   * The practice location (the track). Null for the link Speedhive's own site gives out today,
   * `/practice/<activityId>/activity`, which names only the visit: the practice API knows its
   * location (`importSpeedhivePracticeActivity` reads it from there).
   */
  locationId: number | null;
  activityId: number;
  /** When set, import only this stint within the practice activity. */
  trainingSessionId?: number;
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

export function buildSpeedhivePracticeRunUrl(
  locationId: number,
  activityId: number,
  trainingSessionId: number
): string {
  return `https://speedhive.mylaps.com/practice/${locationId}/activities/${activityId}/sessions/${trainingSessionId}`;
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
      path.match(/\/practice\/(\d+)\/activities\/(\d+)\/sessions\/(\d+)/i) ??
      path.match(/\/practice\/(\d+)\/activity\/(\d+)\/sessions\/(\d+)/i) ??
      path.match(/\/practice\/(\d+)\/activities\/(\d+)/i) ??
      path.match(/\/practice\/(\d+)\/activity\/(\d+)/i);
    if (!m?.[1] || !m[2]) {
      /*
       * The link Speedhive's site gives out now: `/practice/<activityId>/activity`. Every session
       * on a club's practice page links this way, so it is the only one a racer can copy — and
       * read with the location-first shapes above it matched nothing, fell through to the generic
       * page reader and failed as "no lap-shaped numbers" (test drive, 2026-09-26).
       */
      const visit = path.match(/\/practice\/(\d+)\/activity$/i);
      const activityId = visit?.[1] ? Number(visit[1]) : NaN;
      if (!Number.isFinite(activityId) || activityId <= 0) return null;
      return {
        locationId: null,
        activityId,
        sessionUrl: `https://speedhive.mylaps.com/practice/${activityId}/activity`,
      };
    }
    const locationId = Number(m[1]);
    const activityId = Number(m[2]);
    const trainingSessionId = m[3] ? Number(m[3]) : undefined;
    if (!Number.isFinite(locationId) || locationId <= 0) return null;
    if (!Number.isFinite(activityId) || activityId <= 0) return null;
    if (
      trainingSessionId != null &&
      (!Number.isFinite(trainingSessionId) || trainingSessionId <= 0)
    ) {
      return null;
    }
    const sessionUrl =
      trainingSessionId != null
        ? buildSpeedhivePracticeRunUrl(locationId, activityId, trainingSessionId)
        : buildSpeedhivePracticeActivityUrl(locationId, activityId);
    return {
      locationId,
      activityId,
      trainingSessionId,
      sessionUrl,
    };
  } catch {
    return null;
  }
}

/**
 * A club's practice page on Speedhive (`/practice/3472`): the list of every session there, not one
 * session. Pasted where a session link goes, it has no laps to give.
 */
export function isSpeedhivePracticeLocationPageUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    if (!isSpeedhiveHostname(u.hostname)) return false;
    return /\/practice\/\d+$/i.test(u.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export function practiceLocationIdFromTrackUrl(
  speedhiveUrl: string | null | undefined
): number | null {
  if (!speedhiveUrl?.trim()) return null;
  return parseSpeedhivePracticeLocationId(speedhiveUrl);
}
