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
  /**
   * Epoch millis of the transponder crossing on the TRACK's clock — the wall clock as-if-UTC, not
   * a real instant, the same clock as the session's zoneless `startTime` (checked live 2026-09-17:
   * seven Japanese meetings crossed between 10:30 and 15:30 this way, 19:30–00:30 read as UTC).
   */
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

/** Events page size when walking an organisation back through its history. */
const EVENT_PAGE_SIZE = 50;
/** 2,000 events — years of any club. Only a feed that never ends reaches it. */
const EVENT_PAGE_GUARD = 40;

/**
 * Every event an organisation posted that started on or after `earliestYmd`, newest first, walked
 * page by page. Only the newest twelve were read before, so a meeting older than a busy club's
 * last twelve could never be imported. `complete` is false only when the guard stopped the walk.
 */
export async function fetchOrganizationEventsSince(
  organizationId: number,
  earliestYmd: string
): Promise<{ events: SpeedhiveEventRow[]; complete: boolean }> {
  const events: SpeedhiveEventRow[] = [];
  for (let page = 0; page < EVENT_PAGE_GUARD; page++) {
    const data = await speedhiveFetchJson<SpeedhiveEventRow[]>(
      `/organizations/${organizationId}/events`,
      { count: String(EVENT_PAGE_SIZE), offset: String(page * EVENT_PAGE_SIZE) }
    );
    const rows = Array.isArray(data) ? data : [];
    let reachedOlder = false;
    for (const e of rows) {
      const ymd = e.startDate?.slice(0, 10) ?? null;
      if (ymd && ymd < earliestYmd) {
        reachedOlder = true;
        continue;
      }
      events.push(e);
    }
    if (reachedOlder || rows.length < EVENT_PAGE_SIZE) return { events, complete: true };
  }
  return { events, complete: false };
}

type SessionGroup = { sessions?: SpeedhiveSessionRow[]; subGroups?: SessionGroup[] };
type SessionsPayload = {
  sessions?: SpeedhiveSessionRow[];
  groups?: SessionGroup[];
};

export async function fetchEventSessions(eventId: number): Promise<SpeedhiveSessionRow[]> {
  const data = await speedhiveFetchJson<SessionsPayload>(`/events/${eventId}/sessions`);
  const out: SpeedhiveSessionRow[] = [];
  if (Array.isArray(data.sessions)) {
    for (const s of data.sessions) out.push({ ...s, eventId });
  }
  // RC meetings nest class → qualifying → heat → round, and the sessions sit in `subGroups`
  // leaves. Reading only the top level found none of a real meeting's 19 sessions (2026-09-17).
  const walk = (groups: SessionGroup[] | undefined, depth: number) => {
    if (!Array.isArray(groups) || depth > 8) return;
    for (const g of groups) {
      if (Array.isArray(g.sessions)) for (const s of g.sessions) out.push({ ...s, eventId });
      walk(g.subGroups, depth + 1);
    }
  };
  walk(data.groups, 0);
  const seen = new Set<number>();
  return out.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
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
