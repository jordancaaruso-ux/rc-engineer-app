import { NextResponse } from "next/server";
import type { PushSubscription as WebPushSubscription } from "web-push";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { sendPush } from "@/lib/webPush/server";

/**
 * Plumbing test: send a push to the caller's own live subscription immediately.
 * Proves the SW + VAPID + delivery path end-to-end without persistence.
 * Auth-gated so it can't be used to spam arbitrary endpoints.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getAuthenticatedApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { subscription?: WebPushSubscription } | null = null;
  try {
    body = (await req.json()) as { subscription?: WebPushSubscription };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subscription = body?.subscription;
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: "Missing push subscription" }, { status: 400 });
  }

  try {
    await sendPush(subscription, {
      title: "JRC Race Engineer",
      body: "Push is working — this is where run alerts will land.",
      url: "/",
      tag: "jrc-test",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send push";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
