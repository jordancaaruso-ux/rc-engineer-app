import { NextResponse } from "next/server";

import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Forget one native device (user turned notifications off on this device).
 *
 * The token identifies the device; it is cached client-side because
 * `PushNotifications.unregister()` discards it. Scoped to the caller's own rows, so a
 * stale or foreign token deletes nothing rather than affecting another user.
 */
export async function POST(req: Request): Promise<Response> {
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { token?: string } | null = null;
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  await prisma.nativePushDevice
    .deleteMany({ where: { userId: userId, token } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
