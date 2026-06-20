import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ batteryId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { batteryId } = await context.params;

  const existing = await prisma.battery.findFirst({
    where: { id: batteryId, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Battery not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { userId: user.id, batteryId },
  });
  if (runCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete — ${runCount} run${runCount === 1 ? "" : "s"} still linked to this pack.`,
        runCount,
      },
      { status: 409 }
    );
  }

  await prisma.battery.deleteMany({
    where: { id: batteryId, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
