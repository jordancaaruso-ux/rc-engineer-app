import "server-only";

import { timingUserAgent } from "@/lib/http/timingUserAgent";

const API_BASE = "https://api2.mylaps.com";
const DEFAULT_TIMEOUT_MS = 18_000;

export type SpeedhiveEventRow = {
  id: number;
  name?: string;
  startDate?: string;
  updatedAt?: string;
};

export type SpeedhiveSessionRow = {
  id: number;
  name?: string;
  startTime?: string;
  type?: string;
  groupName?: string;
  eventId?: number;
};

export type SpeedhiveClassificationRow = {
  position: number;
  name: string;
  resultClass?: string;
  bestTime?: string;
  /** Present on some timing feeds — used for transponder-based matching. */
  transponder?: string | number;
  transponderId?: string | number;
  transponderNumber?: string | number;
  chip?: string | number;
  chipNumber?: string | number;
  codeNr?: string | number;
  nr?: string | number;
  competitor?: Record<string, unknown>;
};

export type SpeedhiveLapRow = {
  lap: number;
  lapTime: string;
  inPit?: boolean;
  /** Epoch millis of the transponder crossing — a true instant (unlike session `startTime`, which is zoneless track-local schedule). */
  timeOfDay?: number;
};

export type SpeedhiveCompetitorLaps = {
  position: number;
  name: string;
  laps: number[];
};

async function speedhiveFetchJson<T>(path: string, query?: Record<string, string>): Promise<T> {
  const u = new URL(path, API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      u.searchParams.set(k, v);
    }
  }
  return fetchTimingJson<T>(u.toString(), {
    Accept: "application/json",
    "User-Agent": timingUserAgent(),
  }, "Speedhive API");
}

/**
 * One GET against a MYLAPS API, with a single retry when the site pushes back.
 *
 * A burst of scans — the lap step opening, a Refresh tap, a second run logged a minute later —
 * earns a 429 (or a passing 5xx) from MYLAPS, and the whole scan then failed with "Couldn't check
 * the timing site just now", seen on a real drive of three runs in a row. One short wait and one
 * more try is what a driver would do by hand; anything more would hold the page for longer than
 * the message it replaces. Client errors other than 429 are not retried — they will not change.
 */
export async function fetchTimingJson<T>(
  url: string,
  headers: Record<string, string>,
  label: string
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 1) throw new Error(`${label} HTTP ${res.status}`);
      // A retryable refusal on the first try falls through to the wait below.
    } catch (err) {
      if (attempt >= 1) throw err;
      // A definite answer (404, 400…) will not change; a timeout or a dropped socket might.
      if (err instanceof Error && /HTTP \d{3}$/.test(err.message)) throw err;
    } finally {
      clearTimeout(t);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

const RETRY_DELAY_MS = 1500;

export async function fetchOrganizationEvents(
  organizationId: number,
  count = 25
): Promise<SpeedhiveEventRow[]> {
  const data = await speedhiveFetchJson<SpeedhiveEventRow[]>(
    `/organizations/${organizationId}/events`,
    { count: String(count) }
  );
  return Array.isArray(data) ? data : [];
}

type SessionsPayload = {
  sessions?: SpeedhiveSessionRow[];
  groups?: Array<{ sessions?: SpeedhiveSessionRow[] }>;
};

export async function fetchEventSessions(eventId: number): Promise<SpeedhiveSessionRow[]> {
  const data = await speedhiveFetchJson<SessionsPayload>(`/events/${eventId}/sessions`);
  const out: SpeedhiveSessionRow[] = [];
  if (Array.isArray(data.sessions)) {
    for (const s of data.sessions) out.push({ ...s, eventId });
  }
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!Array.isArray(g.sessions)) continue;
      for (const s of g.sessions) out.push({ ...s, eventId });
    }
  }
  return out;
}

type ClassificationPayload = {
  rows?: SpeedhiveClassificationRow[];
};

export async function fetchSessionClassification(
  sessionId: number
): Promise<SpeedhiveClassificationRow[]> {
  const data = await speedhiveFetchJson<ClassificationPayload>(
    `/sessions/${sessionId}/classification`
  );
  return Array.isArray(data.rows) ? data.rows : [];
}

type AllLapTimesRow = {
  position: number;
  laps?: SpeedhiveLapRow[];
};

export async function fetchSessionAllLapTimes(sessionId: number): Promise<AllLapTimesRow[]> {
  const data = await speedhiveFetchJson<AllLapTimesRow[]>(`/sessions/${sessionId}/alllaptimes`);
  return Array.isArray(data) ? data : [];
}

export function parseSpeedhiveLapTimeSeconds(lapTime: string): number | null {
  const t = lapTime.trim();
  if (!t || t === "-") return null;
  const parts = t.split(":");
  try {
    if (parts.length === 2) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1].replace(",", "."));
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
      return minutes * 60 + seconds;
    }
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function buildSessionPageUrl(eventId: number | undefined, sessionId: number): string {
  if (eventId) {
    return `https://speedhive.mylaps.com/events/${eventId}/sessions/${sessionId}`;
  }
  return `https://api2.mylaps.com/sessions/${sessionId}`;
}
