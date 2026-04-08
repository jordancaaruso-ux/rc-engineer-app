import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeActionItemKey } from "@/lib/actionItems";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const items = await prisma.actionItem.findMany({
    where: { userId: user.id, isArchived: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      sourceType: true,
      createdAt: true,
      sourceRunId: true,
    },
  });
  return NextResponse.json({
    items: items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json()) as { text?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const normKey = normalizeActionItemKey(text);
  if (!normKey) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const existing = await prisma.actionItem.findFirst({
    where: { userId: user.id, normKey, isArchived: false },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "duplicate", itemId: existing.id }, { status: 409 });
  }

  const item = await prisma.actionItem.create({
    data: {
      userId: user.id,
      text,
      normKey,
      sourceType: "MANUAL",
    },
    select: {
      id: true,
      text: true,
      sourceType: true,
      createdAt: true,
      sourceRunId: true,
    },
  });

  revalidatePath("/");
  revalidatePath("/runs/new");
  revalidatePath("/engineer");

  return NextResponse.json({
    item: {
      ...item,
      createdAt: item.createdAt.toISOString(),
    },
  });
}
