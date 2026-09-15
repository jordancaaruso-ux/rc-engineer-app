import "server-only";

import { createSign } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { PushPayload } from "@/lib/webPush/server";

/**
 * FCM (HTTP v1) send path for the Android shell — the APNs twin. Same payload contract: the
 * title/body become the notification, `url` rides in `data` for `CapacitorPushBridge` to open
 * on tap, `tag` collapses repeats.
 *
 * Env:
 *   FCM_SERVICE_ACCOUNT_JSON — the Firebase service-account JSON, as one line (literal \n in
 *                              the private key is tolerated). Firebase console → Project
 *                              settings → Service accounts → Generate new private key.
 */

const TOKEN_TTL_MS = 50 * 60 * 1000;
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

export function isFcmConfigured(): boolean {
  return Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON?.trim());
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    const key = parsed.private_key.includes("\\n")
      ? parsed.private_key.replace(/\\n/g, "\n")
      : parsed.private_key;
    return { client_email: parsed.client_email, private_key: key, project_id: parsed.project_id };
  } catch {
    return null;
  }
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedAccess: { token: string; issuedAt: number } | null = null;

/** OAuth access token from a signed JWT (RS256). Cached well inside Google's one-hour life. */
async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Date.now();
  if (cachedAccess && now - cachedAccess.issuedAt < TOKEN_TTL_MS) return cachedAccess.token;

  const iat = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const assertion = `${header}.${claims}.${base64Url(signer.sign(sa.private_key))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!body?.access_token) return null;
  cachedAccess = { token: body.access_token, issuedAt: now };
  return body.access_token;
}

type FcmResult = { status: number; errorCode?: string };

async function sendOne(
  sa: ServiceAccount,
  token: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<FcmResult> {
  const message = {
    message: {
      token: deviceToken,
      notification: { title: payload.title, ...(payload.body ? { body: payload.body } : {}) },
      data: { ...(payload.url ? { url: payload.url } : {}), ...(payload.tag ? { tag: payload.tag } : {}) },
      android: {
        ...(payload.tag ? { collapse_key: payload.tag, notification: { tag: payload.tag } } : {}),
      },
    },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => null);
  if (!res) return { status: 0 };
  if (res.ok) return { status: res.status };
  let errorCode: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { details?: Array<{ errorCode?: string }>; status?: string };
    };
    errorCode = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, errorCode };
}

/** A token Google says will never be valid again — safe to delete. */
function isDeadToken(r: FcmResult): boolean {
  return r.status === 404 || r.errorCode === "UNREGISTERED" || r.errorCode === "NOT_FOUND";
}

/**
 * Send to every Android device registered to a user. Prunes dead tokens. Never throws — a push
 * failure must not fail its caller.
 */
export async function sendFcmToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; devices: number }> {
  const sa = serviceAccount();
  if (!sa) return { sent: 0, pruned: 0, devices: 0 };

  const devices = await prisma.nativePushDevice.findMany({ where: { userId, platform: "android" } });
  if (devices.length === 0) return { sent: 0, pruned: 0, devices: 0 };

  const token = await accessToken(sa);
  if (!token) return { sent: 0, pruned: 0, devices: devices.length };

  let sent = 0;
  let pruned = 0;
  const results = await Promise.all(
    devices.map(async (device) => ({ device, result: await sendOne(sa, token, device.token, payload) })),
  );
  for (const { device, result } of results) {
    if (result.status >= 200 && result.status < 300) {
      sent += 1;
    } else if (isDeadToken(result)) {
      await prisma.nativePushDevice.delete({ where: { id: device.id } }).catch(() => {});
      pruned += 1;
    }
  }
  if (sent > 0) {
    await prisma.nativePushDevice
      .updateMany({ where: { userId, platform: "android" }, data: { lastNotifiedAt: new Date() } })
      .catch(() => {});
  }
  return { sent, pruned, devices: devices.length };
}
