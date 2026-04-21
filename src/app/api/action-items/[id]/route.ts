import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { isArchived?: boolean };
  if (body.isArchived !== true) {
    return NextResponse.json({ error: "isArchived: true required" }, { status: 400 });
  }

  const row = await prisma.actionItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.actionItem.updateMany({
    where: { id, userId: user.id },
    data: { isArchived: true },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidatePath("/");
  revalidatePath("/runs/new");
  revalidatePath("/engineer");

  return NextResponse.json({ ok: true });
}
