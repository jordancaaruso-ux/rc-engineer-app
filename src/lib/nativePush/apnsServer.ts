import "server-only";

import http2 from "node:http2";
import { createSign } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { PushPayload } from "@/lib/webPush/server";

/**
 * APNs send path for the Capacitor shell (the web-push transport cannot reach it —
 * WKWebView has no Push API).
 *
 * Env (see docs/TESTFLIGHT.md):
 *   APNS_KEY_ID       — 10-char key id of the .p8
 *   APNS_TEAM_ID      — 10-char Apple team id
 *   APNS_PRIVATE_KEY  — contents of the .p8 (literal \n escapes are tolerated)
 *   APNS_BUNDLE_ID    — defaults to the shell's appId
 *   APNS_PRODUCTION   — "1" for api.push.apple.com, else the sandbox host
 *
 * Host gotcha: TestFlight and App Store builds are **production**; only builds run
 * from Xcode onto a device are sandbox. A token minted in one environment is
 * rejected by the other with BadDeviceToken.
 */

const DEFAULT_BUNDLE_ID = "com.rcengineer.app";
const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

/** Apple rejects tokens older than 1h and refreshes more often than every 20min. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY,
  );
}

function privateKey(): string {
  const raw = process.env.APNS_PRIVATE_KEY ?? "";
  // Vercel/dotenv commonly store the PEM with escaped newlines.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedJwt: { token: string; issuedAt: number } | null = null;

/** Provider auth token (ES256). Cached — Apple rate-limits regeneration. */
function providerToken(): string {
  const now = Date.now();
  if (cachedJwt && now - cachedJwt.issuedAt < TOKEN_TTL_MS) return cachedJwt.token;

  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID, typ: "JWT" }),
  );
  const claims = base64Url(
    JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) }),
  );

  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  // APNs wants the JOSE (r||s) form, not the DER encoding Node emits by default.
  const signature = signer.sign({ key: privateKey(), dsaEncoding: "ieee-p1363" });

  const token = `${header}.${claims}.${base64Url(signature)}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

type ApnsResult = { status: number; reason?: string };

function sendOne(
  session: http2.ClientHttp2Session,
  deviceToken: string,
  payload: PushPayload,
): Promise<ApnsResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        // Matches the web-push `tag` so repeat alerts coalesce the same way.
        "thread-id": payload.tag,
      },
      // Read by CapacitorPushBridge on tap — same contract as the service worker.
      url: payload.url,
    });

    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "apns-topic": process.env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID,
      "apns-push-type": "alert",
      authorization: `bearer ${providerToken()}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });

    let status = 0;
    let raw = "";

    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = raw ? (JSON.parse(raw) as { reason?: string }).reason : undefined;
      } catch {
        /* non-JSON error body */
      }
      resolve({ status, reason });
    });
    req.on("error", () => resolve({ status: 0, reason: "RequestFailed" }));

    req.end(body);
  });
}

/** A token Apple says will never be valid again — safe to delete. */
function isDeadToken(result: ApnsResult): boolean {
  return (
    result.status === 410 ||
    result.reason === "BadDeviceToken" ||
    result.reason === "Unregistered"
  );
}

/**
 * Send to every native device registered to a user. Prunes tokens Apple rejects as
 * permanently invalid. Never throws — a push failure must not fail its caller.
 */
export async function sendApnsToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; devices: number }> {
  if (!isApnsConfigured()) return { sent: 0, pruned: 0, devices: 0 };

  const devices = await prisma.nativePushDevice.findMany({
    where: { userId, platform: "ios" },
  });
  if (devices.length === 0) return { sent: 0, pruned: 0, devices: 0 };

  const host = process.env.APNS_PRODUCTION === "1" ? PROD_HOST : SANDBOX_HOST;
  const session = http2.connect(host);
  session.on("error", () => {
    /* surfaced per-request as status 0 */
  });

  let sent = 0;
  let pruned = 0;

  try {
    const results = await Promise.all(
      devices.map(async (device) => ({
        device,
        result: await sendOne(session, device.token, payload),
      })),
    );

    for (const { device, result } of results) {
      if (result.status === 200) {
        sent += 1;
      } else if (isDeadToken(result)) {
        await prisma.nativePushDevice.delete({ where: { id: device.id } }).catch(() => {});
        pruned += 1;
      }
    }
  } finally {
    session.close();
  }

  if (sent > 0) {
    await prisma.nativePushDevice
      .updateMany({ where: { userId }, data: { lastNotifiedAt: new Date() } })
      .catch(() => {});
  }

  return { sent, pruned, devices: devices.length };
}
