import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

type RouteParams = { params: Promise<{ threadId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await params;
  const id = threadId?.trim();
  if (!id) return NextResponse.json({ error: "threadId required" }, { status: 400 });

  const deleted = await prisma.engineerChatThread.deleteMany({
    where: { id, userId: userId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
