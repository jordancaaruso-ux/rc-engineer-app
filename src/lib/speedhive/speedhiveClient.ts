import "server-only";

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
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.LAP_IMPORT_USER_AGENT?.trim() || "RC-Engineer/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Speedhive API HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

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
