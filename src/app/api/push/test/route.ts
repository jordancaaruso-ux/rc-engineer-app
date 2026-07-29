import { NextResponse } from "next/server";

import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Send a test push to all of the caller's registered devices (via stored
 * subscriptions). Exercises the real send path the cron/triggers use.
 */
export async function POST(): Promise<Response> {
  const userId = await getAuthenticatedApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendPushToUser(userId, {
      title: "JRC Race Engineer",
      body: "Push is working — this is where run alerts will land.",
      url: "/",
      tag: "jrc-test",
    });
    if (result.devices === 0) {
      return NextResponse.json(
        { error: "No registered devices. Enable notifications first." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send push";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
