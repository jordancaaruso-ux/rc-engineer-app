import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeTireMark } from "@/lib/tires/tireMark";

/** Update a set you already own — currently just its physical mark (sidewall / race-control number). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ tireSetId: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tireSetId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { mark?: string | null };

  const existing = await prisma.tireSet.findFirst({
    where: { id: tireSetId, userId: user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Tire set not found" }, { status: 404 });
  }

  const mark = normalizeTireMark(body.mark);
  await prisma.tireSet.updateMany({
    where: { id: tireSetId, userId: user.id },
    data: { mark },
  });
  return NextResponse.json({ ok: true, mark });
}

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

  // Sets linked to runs are archived (soft-deleted) so the run history keeps its
  // tire attribution; unused sets are removed outright.
  if (runCount > 0) {
    await prisma.tireSet.updateMany({
      where: { id: tireSetId, userId: user.id },
      data: { archivedAt: new Date() },
    });
    return NextResponse.json({ ok: true, archived: true, runCount });
  }

  await prisma.tireSet.deleteMany({
    where: { id: tireSetId, userId: user.id },
  });

  return NextResponse.json({ ok: true, archived: false });
}
