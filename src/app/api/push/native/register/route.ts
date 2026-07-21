import { NextResponse } from "next/server";

import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RegisterBody = {
  token?: string;
  platform?: string;
  deviceLabel?: string;
};

const ALLOWED_PLATFORMS = new Set(["ios", "android"]);

/**
 * Persist a native push device token (idempotent by token). Mirrors
 * `/api/push/subscribe` for the Capacitor shell — tokens rotate, so an existing
 * token is re-pointed at this user rather than duplicated.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: RegisterBody | null = null;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const platform = typeof body?.platform === "string" ? body.platform : "";
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const deviceLabel =
    typeof body?.deviceLabel === "string" ? body.deviceLabel.slice(0, 400) : null;

  await prisma.nativePushDevice.upsert({
    where: { token },
    create: { userId: user.id, token, platform, deviceLabel },
    update: { userId: user.id, platform, deviceLabel },
  });

  return NextResponse.json({ ok: true });
}
