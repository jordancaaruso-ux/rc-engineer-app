import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ peerUserId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const { peerUserId } = await context.params;
  const id = typeof peerUserId === "string" ? peerUserId.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "peerUserId is required" }, { status: 400 });
  }

  await prisma.teammateLink.deleteMany({
    where: { userId: user.id, peerUserId: id },
  });

  return NextResponse.json({ ok: true });
}
