import { validateTimingHttpUrlSync } from "@/lib/http/timingUrlSafetySync";
import { parseSpeedhivePracticeLocationId } from "@/lib/speedhive/speedhivePracticeUrl";

const SPEEDHIVE_HOSTS = /(?:^|\.)((?:speedhive\.)?mylaps\.com|sporthive\.com)$/i;
const API2_HOST = /^api2\.mylaps\.com$/i;

export type ParsedSpeedhiveSessionRef = {
  sessionId: number;
  eventId?: number;
  sessionUrl: string;
};

export function isSpeedhiveHostname(hostname: string): boolean {
  return SPEEDHIVE_HOSTS.test(hostname.toLowerCase());
}

export function isSpeedhiveOrApiUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr.trim());
    return isSpeedhiveHostname(u.hostname) || API2_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Parse organization id from Speedhive / MYLAPS timing URLs. */
export function parseSpeedhiveOrganizationId(urlStr: string): number | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/\/+$/, "");
    const hash = u.hash.replace(/^#\/?/, "");
    const combined = `${path}/${hash}`;

    const patterns = [
      /\/organizations\/(\d+)/i,
      /\/organization\/(\d+)/i,
      /\/api\/organizations\/(\d+)/i,
      /organizations\/(\d+)/i,
    ];
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

export function parseSpeedhiveSessionRef(urlStr: string): ParsedSpeedhiveSessionRef | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    const hash = u.hash.replace(/^#\/?/, "");
    const combined = `${path}/${hash}`;

    let sessionId: number | null = null;
    let eventId: number | undefined;

    if (API2_HOST.test(host)) {
      const m = path.match(/\/sessions\/(\d+)/i);
      if (m?.[1]) sessionId = Number(m[1]);
    } else if (isSpeedhiveHostname(host)) {
      const sessionMatch =
        combined.match(/\/sessions\/(\d+)/i) ?? combined.match(/\/session\/(\d+)/i);
      if (sessionMatch?.[1]) sessionId = Number(sessionMatch[1]);
      const eventMatch = combined.match(/\/events\/(\d+)/i);
      if (eventMatch?.[1]) eventId = Number(eventMatch[1]);
    }

    if (!sessionId || !Number.isFinite(sessionId) || sessionId <= 0) return null;

    const sessionUrl = eventId
      ? `https://speedhive.mylaps.com/events/${eventId}/sessions/${sessionId}`
      : `https://api2.mylaps.com/sessions/${sessionId}`;

    return { sessionId, eventId, sessionUrl };
  } catch {
    return null;
  }
}

export type SpeedhiveTrackUrlKind = "practice" | "organization";

export function validateSpeedhiveTrackUrl(url: string):
  | {
      ok: true;
      normalized: string;
      kind: SpeedhiveTrackUrlKind;
      organizationId: number | null;
      practiceLocationId: number | null;
    }
  | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "Speedhive URL is required." };
  }
  const v = validateTimingHttpUrlSync(trimmed);
  if (!v.ok) return v;
  try {
    const u = new URL(v.normalized);
    if (!isSpeedhiveHostname(u.hostname) && !API2_HOST.test(u.hostname)) {
      return {
        ok: false,
        error: "URL must be a speedhive.mylaps.com or sporthive.com track page.",
      };
    }
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const practiceLocationId = parseSpeedhivePracticeLocationId(v.normalized);
  if (practiceLocationId) {
    const normalized = `https://speedhive.mylaps.com/practice/${practiceLocationId}`;
    return {
      ok: true,
      normalized,
      kind: "practice",
      organizationId: null,
      practiceLocationId,
    };
  }

  const organizationId = parseSpeedhiveOrganizationId(v.normalized);
  if (!organizationId) {
    return {
      ok: false,
      error:
        "Could not parse this Speedhive URL. Paste a practice track link (…/practice/4591) or an organization page (…/organizations/123).",
    };
  }
  return {
    ok: true,
    normalized: v.normalized,
    kind: "organization",
    organizationId,
    practiceLocationId: null,
  };
}

export function organizationIdFromTrackUrl(speedhiveUrl: string | null | undefined): number | null {
  if (!speedhiveUrl?.trim()) return null;
  return parseSpeedhiveOrganizationId(speedhiveUrl);
}
