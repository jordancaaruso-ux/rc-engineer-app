import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { blockDriver, driversAreConnected, unblockDriver } from "@/lib/moderation/blocks";

export const dynamic = "force-dynamic";

/**
 * Block (POST `{ userId }`) or unblock (DELETE `?userId=`) another driver (App Store guideline
 * 1.2, 2026-09-26). What a block does is in `src/lib/moderation/blocks.ts`.
 *
 * Blocking needs a shared team or an invite between the two, so it can't be aimed at any account
 * id. Unblocking needs nothing but the viewer's own block row.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const viewerId = await getAuthenticatedApiUserId();
  if (!viewerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!userId || userId === viewerId) {
    return NextResponse.json({ error: "Pick a driver to block" }, { status: 400 });
  }
  if (!(await driversAreConnected(viewerId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await blockDriver(viewerId, userId);
  return NextResponse.json({ ok: true, blocked: true });
}

export async function DELETE(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const viewerId = await getAuthenticatedApiUserId();
  if (!viewerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = new URL(request.url).searchParams.get("userId")?.trim() ?? "";
  if (!userId) return NextResponse.json({ error: "Pick a driver to unblock" }, { status: 400 });

  await unblockDriver(viewerId, userId);
  return NextResponse.json({ ok: true, blocked: false });
}
