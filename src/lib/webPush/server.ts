import "server-only";

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

import { prisma } from "@/lib/prisma";

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

/**
 * Send a push to every device a user has registered (the real send path used by
 * the cron + triggers). Prunes endpoints that return 404/410 (expired/unsubscribed).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; devices: number }> {
  ensureConfigured();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });

  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          pruned += 1;
        }
      }
    }),
  );

  if (sent > 0) {
    await prisma.pushSubscription
      .updateMany({ where: { userId }, data: { lastNotifiedAt: new Date() } })
      .catch(() => {});
  }

  return { sent, pruned, devices: subs.length };
}
