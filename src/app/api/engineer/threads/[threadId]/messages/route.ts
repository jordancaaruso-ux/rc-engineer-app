import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { contextSnapshotFromMessageMetadata } from "@/lib/engineerFeedback/persistExchange";

type RouteParams = { params: Promise<{ threadId: string }> };

const MAX_MESSAGES = 500;

export async function GET(_request: Request, { params }: RouteParams) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await params;
  const id = threadId?.trim();
  if (!id) return NextResponse.json({ error: "threadId required" }, { status: 400 });

  const thread = await prisma.engineerChatThread.findFirst({
    where: { id, userId: userId },
    select: {
      id: true,
      updatedAt: true,
      primaryRunId: true,
      compareRunId: true,
      focusAnchorJson: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: MAX_MESSAGES,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          metadataJson: true,
        },
      },
    },
  });

  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    thread: {
      id: thread.id,
      updatedAt: thread.updatedAt.toISOString(),
      primaryRunId: thread.primaryRunId,
      compareRunId: thread.compareRunId,
      focusAnchor: thread.focusAnchorJson ?? null,
    },
    messages: thread.messages.map((m) => {
      const role = m.role === "assistant" ? ("assistant" as const) : ("user" as const);
      const base = {
        id: m.id,
        role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      };
      if (role !== "assistant") return base;
      const ratingContext = contextSnapshotFromMessageMetadata(m.metadataJson, {
        answer: m.content,
      });
      return { ...base, ratingContext };
    }),
  });
}
