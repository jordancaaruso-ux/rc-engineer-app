import "server-only";

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

/**
 * Server-side web-push send path. VAPID keys come from env (see .env.local /
 * Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Persistence of
 * subscriptions (a `PushSubscription` Prisma model) is a later pass — for now
 * callers pass a live subscription (e.g. the /api/push/test route).
 */

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@jrcraceengineer.app";
  if (!publicKey || !privateKey) {
    throw new Error(
      "Web push not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export function isWebPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
};

export async function sendPush(
  subscription: WebPushSubscription,
  payload: PushPayload,
): Promise<void> {
  ensureConfigured();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
