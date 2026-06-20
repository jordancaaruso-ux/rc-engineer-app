import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tireSetId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tireSetId } = await context.params;

  const existing = await prisma.tireSet.findFirst({
    where: { id: tireSetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire set not found" }, { status: 404 });
  }

  const runCount = await prisma.run.count({
    where: { userId: user.id, tireSetId },
  });
  if (runCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete — ${runCount} run${runCount === 1 ? "" : "s"} still linked to this set.`,
        runCount,
      },
      { status: 409 }
    );
  }

  await prisma.tireSet.deleteMany({
    where: { id: tireSetId, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
