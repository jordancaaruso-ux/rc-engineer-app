import "server-only";

const PRACTICE_API_BASE = "https://practice-api.speedhive.com";
const DEFAULT_TIMEOUT_MS = 18_000;

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
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Origin: "https://sporthive.com",
        "User-Agent": process.env.LAP_IMPORT_USER_AGENT?.trim() || "RC-Engineer/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Speedhive practice API HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
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
