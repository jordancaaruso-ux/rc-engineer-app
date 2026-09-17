import "server-only";

import { timingUserAgent } from "@/lib/http/timingUserAgent";
import { fetchTimingJson } from "@/lib/speedhive/speedhiveClient";

const PRACTICE_API_BASE = "https://practice-api.speedhive.com";

export type SpeedhivePracticeLocation = {
  id: number;
  name?: string;
  sport?: string;
  country?: string;
};

export type SpeedhivePracticeActivityRow = {
  id: number;
  name?: string;
  startTime?: string;
  endTime?: string;
  chipLabel?: string;
  chipCode?: string;
};

export type SpeedhivePracticeSessionRow = {
  id: number;
  locationId?: number;
  starttimeutc?: number;
  endtimeutc?: number;
};

export type SpeedhivePracticeLapRow = {
  nr?: number;
  dateTimeStart?: string;
  duration?: string;
  inPit?: boolean;
};

export type SpeedhivePracticeTrainingSession = {
  id: number;
  dateTimeStart?: string;
  laps?: SpeedhivePracticeLapRow[];
};

async function practiceFetchJson<T>(path: string, query?: Record<string, string>): Promise<T> {
  const u = new URL(path, PRACTICE_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      u.searchParams.set(k, v);
    }
  }
  // Same one-retry rule as the results API — see `fetchTimingJson`.
  return fetchTimingJson<T>(
    u.toString(),
    {
      Accept: "application/json",
      Origin: "https://sporthive.com",
      "User-Agent": timingUserAgent(),
    },
    "Speedhive practice API"
  );
}

/** Practice API timestamps are often nanoseconds since Unix epoch. */
export function practiceTimestampToIso(raw: number | undefined | null): string | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  let ms: number;
  if (raw > 1e14) ms = raw / 1_000_000;
  else if (raw > 1e11) ms = raw;
  else ms = raw * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function fetchPracticeLocation(locationId: number): Promise<SpeedhivePracticeLocation | null> {
  try {
    const data = await practiceFetchJson<SpeedhivePracticeLocation>(
      `/api/v1/locations/${locationId}`
    );
    return data?.id ? data : null;
  } catch {
    return null;
  }
}

export async function fetchPracticeLocationActivities(
  locationId: number,
  opts?: { count?: number; sport?: string }
): Promise<SpeedhivePracticeActivityRow[]> {
  const data = await practiceFetchJson<{
    activities?: SpeedhivePracticeActivityRow[];
  }>(`/api/v1/locations/${locationId}/activities`, {
    count: String(opts?.count ?? 40),
    order: "desc",
    ...(opts?.sport ? { sport: opts.sport } : { sport: "RC" }),
  });
  return Array.isArray(data.activities) ? data.activities : [];
}

/** Activities per page when walking a location back to a day. */
const ACTIVITY_PAGE_SIZE = 100;
/** 10,000 activities — far past a fortnight at the busiest track seen. Only a runaway feed reaches it. */
const ACTIVITY_PAGE_GUARD = 100;
/** No practice visit runs longer than this; once a page starts this far before the window, stop. */
const ACTIVITY_MAX_SPAN_MS = 36 * 60 * 60 * 1000;

/**
 * Every activity at a location that overlaps the window, walked back page by page (newest first).
 * Only the newest twenty or forty were read before, so at a busy track a day more than a few hours
 * old was already off the list. `complete` is false only when the guard stopped the walk.
 */
export async function fetchPracticeLocationActivitiesInWindow(
  locationId: number,
  window: { start: Date; end: Date },
  opts?: { sport?: string }
): Promise<{ activities: SpeedhivePracticeActivityRow[]; complete: boolean }> {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  const activities: SpeedhivePracticeActivityRow[] = [];
  for (let page = 0; page < ACTIVITY_PAGE_GUARD; page++) {
    const data = await practiceFetchJson<{ activities?: SpeedhivePracticeActivityRow[] }>(
      `/api/v1/locations/${locationId}/activities`,
      {
        count: String(ACTIVITY_PAGE_SIZE),
        offset: String(page * ACTIVITY_PAGE_SIZE),
        order: "desc",
        sport: opts?.sport ?? "RC",
      }
    );
    const rows = Array.isArray(data.activities) ? data.activities : [];
    let oldestStart = Number.POSITIVE_INFINITY;
    for (const a of rows) {
      const s = a.startTime ? Date.parse(a.startTime) : Number.NaN;
      if (!Number.isFinite(s)) continue;
      oldestStart = Math.min(oldestStart, s);
      const e = a.endTime ? Date.parse(a.endTime) : Number.NaN;
      if (s < endMs && (Number.isFinite(e) ? e : s) >= startMs) activities.push(a);
    }
    if (rows.length < ACTIVITY_PAGE_SIZE || oldestStart < startMs - ACTIVITY_MAX_SPAN_MS) {
      return { activities, complete: true };
    }
  }
  return { activities, complete: false };
}

export async function fetchPracticeSessionsForChipAtLocation(
  locationId: number,
  chipCode: string
): Promise<SpeedhivePracticeSessionRow[]> {
  const data = await practiceFetchJson<{ locations?: SpeedhivePracticeSessionRow[] }>(
    `/api/v1/locations/${locationId}/${encodeURIComponent(chipCode)}`,
    { order: "desc" }
  );
  return Array.isArray(data.locations) ? data.locations : [];
}

export async function fetchPracticeTrainingSessions(
  activityId: number
): Promise<SpeedhivePracticeTrainingSession[]> {
  const data = await practiceFetchJson<{ sessions?: SpeedhivePracticeTrainingSession[] }>(
    `/api/v1/training/activities/${activityId}/sessions`
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}
