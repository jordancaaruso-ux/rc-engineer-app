import "server-only";

import { decodeJwtPayload } from "@/lib/mylaps/decodeJwtPayload";

const USERS_API = "https://usersandproducts-api.speedhive.com";

export function normalizeMylapsAccessToken(raw: string): string {
  const t = raw.trim();
  if (/^bearer\s+/i.test(t)) return t.replace(/^bearer\s+/i, "").trim();
  return t;
}

async function usersFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${USERS_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MYLAPS API ${path} HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function validateMylapsAccessToken(accessToken: string): Promise<boolean> {
  const token = normalizeMylapsAccessToken(accessToken);
  const res = await fetch(`${USERS_API}/auth/validate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}

export async function fetchMylapsClaims(
  accessToken: string
): Promise<Record<string, unknown>> {
  const token = normalizeMylapsAccessToken(accessToken);
  const data = await usersFetch<Record<string, unknown>>("/auth/claims", token, {
    method: "POST",
  });
  return data && typeof data === "object" ? data : {};
}

/** Resolve MYLAPS account id from token claims or JWT payload. */
export function accountIdFromMylapsClaims(
  claims: Record<string, unknown>,
  accessToken?: string
): string | null {
  const candidates = [
    claims.sub,
    claims.userId,
    claims.accountId,
    claims.oid,
    claims.nameidentifier,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  if (accessToken) {
    const payload = decodeJwtPayload(accessToken);
    if (payload) {
      const nested = accountIdFromMylapsClaims(payload);
      if (nested) return nested;
    }
  }
  return null;
}

type ChipProductRow = {
  chip?: { id?: number; codeNr?: number; code?: string; customName?: string | null };
};

export async function fetchMylapsChipNumbers(
  accountId: string,
  accessToken: string
): Promise<number[]> {
  const data = await usersFetch<{ chipProducts?: ChipProductRow[] }>(
    `/api/v2/accounts/${encodeURIComponent(accountId)}/products/chips`,
    accessToken
  );
  const products = data.chipProducts ?? [];
  const nums = new Set<number>();
  for (const p of products) {
    const id = p.chip?.id ?? p.chip?.codeNr;
    if (typeof id === "number" && id > 0) nums.add(id);
  }
  return [...nums];
}

type BadgeRow = {
  eventId?: number;
  sessionId?: number;
  sessionName?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  className?: string | null;
  racer?: { name?: string | null };
};

type BadgesPayload = {
  badges?: BadgeRow[];
};

export async function fetchMylapsAchievementBadges(
  accountId: string,
  accessToken: string
): Promise<BadgeRow[]> {
  const data = await usersFetch<BadgesPayload>(
    `/api/v2/achievements/${encodeURIComponent(accountId)}/overview`,
    accessToken
  );
  return Array.isArray(data.badges) ? data.badges : [];
}

type TimelineMessage = {
  eventId?: string | null;
  sessionId?: string | null;
  timelineName?: string | null;
  racerName?: string | null;
  eventName?: string | null;
  utc?: string | null;
  type?: number;
};

type TimelinePayload = {
  messages?: TimelineMessage[];
};

export async function fetchMylapsTimeline(
  accountId: string,
  accessToken: string
): Promise<TimelineMessage[]> {
  const data = await usersFetch<TimelinePayload>(
    `/api/v1/speedhiveprofile/timeline/${encodeURIComponent(accountId)}`,
    accessToken
  );
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function exchangeMylapsAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string | null;
  codeVerifier?: string | null;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}> {
  const { mylapsOpenIdBase } = await import("@/lib/mylaps/mylapsAuthConfig");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  if (input.codeVerifier) body.set("code_verifier", input.codeVerifier);

  const res = await fetch(`${mylapsOpenIdBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MYLAPS token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
}
