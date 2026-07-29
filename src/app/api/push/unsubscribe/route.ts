import { NextResponse } from "next/server";

import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Remove a device's subscription (user turned notifications off on this device). */
export async function POST(req: Request): Promise<Response> {
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { endpoint?: string } | null = null;
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  await prisma.pushSubscription
    .deleteMany({ where: { userId: userId, endpoint: body.endpoint } })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
