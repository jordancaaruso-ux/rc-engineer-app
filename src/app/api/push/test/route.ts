import { NextResponse } from "next/server";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Send a test push to all of the caller's registered devices (via stored
 * subscriptions). Exercises the real send path the cron/triggers use.
 */
export async function POST(): Promise<Response> {
  const user = await getAuthenticatedApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendPushToUser(user.id, {
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
