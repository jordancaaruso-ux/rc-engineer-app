import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { adminFeedbackRatingWhere } from "@/lib/engineerFeedback/adminFeedbackAccess";

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50;
  const cursor = searchParams.get("cursor")?.trim() || null;

  const rows = await prisma.engineerMessageRating.findMany({
    where: adminFeedbackRatingWhere(),
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stars: true,
      note: true,
      contextSnapshot: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true } },
      message: {
        select: {
          id: true,
          content: true,
          metadataJson: true,
          createdAt: true,
          thread: {
            select: {
              id: true,
              primaryRunId: true,
              compareRunId: true,
            },
          },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return NextResponse.json({
    ratings: items.map((r) => ({
      id: r.id,
      stars: r.stars,
      note: r.note,
      contextSnapshot: r.contextSnapshot,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
      message: {
        id: r.message.id,
        content: r.message.content,
        metadataJson: r.message.metadataJson,
        createdAt: r.message.createdAt.toISOString(),
        thread: r.message.thread,
      },
    })),
    nextCursor,
  });
}
