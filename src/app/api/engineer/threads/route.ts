import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  engineerAnswerPreviewFromContent,
  engineerThreadTitleFromContent,
} from "@/lib/engineerFeedback/threadTitle";

/**
 * How many threads carry an answer preview. Matches the history card's preview count — the
 * card shows the rest as compact rows, so a fourth preview would be fetched and never drawn.
 */
const PREVIEW_THREAD_COUNT = 3;

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 30;
  const cursor = searchParams.get("cursor")?.trim() || null;

  const rows = await prisma.engineerChatThread.findMany({
    where: { userId: userId },
    take: limit + 1,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      updatedAt: true,
      primaryRunId: true,
      compareRunId: true,
      focusAnchorJson: true,
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

  /*
   * The history card previews the top few conversations with what the ENGINEER said
   * (2026-08-20) — the title is already built from the driver's question, so previewing the
   * question would print the same words twice.
   *
   * Deliberately only the first few threads, in one extra query: the answer cannot come from
   * the select above, because Prisma can't take the oldest user message and the newest
   * assistant message from the same relation in one read, and pulling every message of thirty
   * threads to find them would be a far worse trade than this.
   */
  const previewThreadIds = items.slice(0, PREVIEW_THREAD_COUNT).map((row) => row.id);
  const latestAnswers = previewThreadIds.length
    ? await prisma.engineerChatMessage.findMany({
        where: { threadId: { in: previewThreadIds }, role: "assistant" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        distinct: ["threadId"],
        select: { threadId: true, content: true },
      })
    : [];
  const answerByThread = new Map(latestAnswers.map((m) => [m.threadId, m.content]));

  return NextResponse.json({
    threads: items.map((row) => {
      const firstUser = row.messages[0]?.content ?? "";
      const lastAnswer = answerByThread.get(row.id);
      return {
        id: row.id,
        title: engineerThreadTitleFromContent(firstUser),
        preview: firstUser.replace(/\s+/g, " ").trim().slice(0, 120) || null,
        answerPreview: lastAnswer ? engineerAnswerPreviewFromContent(lastAnswer) : null,
        updatedAt: row.updatedAt.toISOString(),
        primaryRunId: row.primaryRunId,
        compareRunId: row.compareRunId,
        focusAnchor: row.focusAnchorJson ?? null,
      };
    }),
    nextCursor,
  });
}
