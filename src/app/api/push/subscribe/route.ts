import { NextResponse } from "next/server";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SubscribeBody = {
  subscription?: { endpoint?: string; p256dh?: string; auth?: string };
  userAgent?: string;
};

/**
 * Persist a device's web-push subscription (idempotent by endpoint). Called from
 * the Settings enable flow. The endpoint is globally unique; if it already exists
 * we re-point it to this user + refresh keys.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SubscribeBody | null = null;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.p256dh || !sub.auth) {
    return NextResponse.json({ error: "Incomplete subscription" }, { status: 400 });
  }

  const userAgent = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 400) : null;

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent,
    },
    update: {
      userId: user.id,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent,
    },
  });

  return NextResponse.json({ ok: true });
}
