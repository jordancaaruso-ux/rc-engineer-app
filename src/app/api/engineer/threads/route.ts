import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { engineerThreadTitleFromContent } from "@/lib/engineerFeedback/threadTitle";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 30;
  const cursor = searchParams.get("cursor")?.trim() || null;

  const rows = await prisma.engineerChatThread.findMany({
    where: { userId: user.id },
    take: limit + 1,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      updatedAt: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return NextResponse.json({
    threads: items.map((row) => {
      const firstUser = row.messages[0]?.content ?? "";
      return {
        id: row.id,
        title: engineerThreadTitleFromContent(firstUser),
        preview: firstUser.replace(/\s+/g, " ").trim().slice(0, 120) || null,
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
    nextCursor,
  });
}
