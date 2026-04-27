import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { ActionItemListKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeActionItemKey, parseActionItemListQuery } from "@/lib/actionItems";

function bodyListKind(body: { listKind?: string }): ActionItemListKind {
  const raw = typeof body.listKind === "string" ? body.listKind : "";
  if (raw === "THINGS_TO_DO" || raw.toLowerCase() === "do") return "THINGS_TO_DO";
  return "THINGS_TO_TRY";
}

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const listKind = parseActionItemListQuery(searchParams.get("list"));
  const items = await prisma.actionItem.findMany({
    where: { userId: user.id, isArchived: false, listKind },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      text: true,
      sourceType: true,
      createdAt: true,
      sourceRunId: true,
      listKind: true,
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
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { text?: string; listKind?: string };
  const listKind = bodyListKind(body);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const normKey = normalizeActionItemKey(text);
  if (!normKey) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const existing = await prisma.actionItem.findFirst({
    where: { userId: user.id, listKind, normKey, isArchived: false },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "duplicate", itemId: existing.id }, { status: 409 });
  }

  const agg = await prisma.actionItem.aggregate({
    where: { userId: user.id, listKind, isArchived: false },
    _max: { sortOrder: true },
  });
  const nextOrder = (agg._max.sortOrder ?? -1) + 1;

  const item = await prisma.actionItem.create({
    data: {
      userId: user.id,
      text,
      normKey,
      listKind,
      sortOrder: nextOrder,
      sourceType: "MANUAL",
    },
    select: {
      id: true,
      text: true,
      sourceType: true,
      createdAt: true,
      sourceRunId: true,
      listKind: true,
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
