import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GDPR / App Store: delete the signed-in user and all owned data (DB cascades).
 * Client should call `signOut({ callbackUrl: "/login" })` after a successful response.
 */
export async function DELETE() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
