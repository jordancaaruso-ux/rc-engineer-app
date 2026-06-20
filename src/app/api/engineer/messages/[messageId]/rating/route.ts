import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { canSubmitEngineerFeedback } from "@/lib/engineerFeedback/adminFeedbackAccess";
import {
  contextSnapshotFromMessageMetadata,
  userCanAccessEngineerMessage,
} from "@/lib/engineerFeedback/persistExchange";
import { mergeContextSnapshots, parseRatingInput } from "@/lib/engineerFeedback/ratingValidation";

type RouteParams = { params: Promise<{ messageId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSubmitEngineerFeedback(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { messageId } = await params;
  if (!messageId?.trim()) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  const allowed = await userCanAccessEngineerMessage(user.id, messageId.trim());
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rating = await prisma.engineerMessageRating.findUnique({
    where: {
      messageId_userId: { messageId: messageId.trim(), userId: user.id },
    },
    select: { stars: true, note: true, updatedAt: true },
  });

  return NextResponse.json({ rating: rating ?? null });
}

export async function POST(request: Request, { params }: RouteParams) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSubmitEngineerFeedback(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { messageId } = await params;
  if (!messageId?.trim()) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  const message = await prisma.engineerChatMessage.findFirst({
    where: {
      id: messageId.trim(),
      role: "assistant",
      thread: { userId: user.id },
    },
    select: { id: true, metadataJson: true, content: true },
  });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = parseRatingInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const baseSnapshot = contextSnapshotFromMessageMetadata(message.metadataJson, {
    answer: message.content,
  });
  const contextSnapshot = mergeContextSnapshots(baseSnapshot, parsed.value.contextSnapshot);

  const rating = await prisma.engineerMessageRating.upsert({
    where: {
      messageId_userId: { messageId: message.id, userId: user.id },
    },
    create: {
      messageId: message.id,
      userId: user.id,
      stars: parsed.value.stars,
      note: parsed.value.note ?? null,
      contextSnapshot,
    },
    update: {
      stars: parsed.value.stars,
      note: parsed.value.note ?? null,
      contextSnapshot,
    },
    select: { id: true, stars: true, note: true, updatedAt: true },
  });

  if (process.env.NODE_ENV === "development") {
    try {
      const { writeFeedbackInboxFiles } = await import("@/lib/engineerFeedback/exportFeedbackInbox");
      await writeFeedbackInboxFiles();
    } catch (e) {
      console.warn("[engineer feedback export]", e);
    }
  }

  return NextResponse.json({ rating }, { status: 201 });
}

export async function PATCH(request: Request, ctx: RouteParams) {
  return POST(request, ctx);
}
