import "server-only";

import { prisma } from "@/lib/prisma";
import { ENGINEER_PROMPT_VERSION } from "@/lib/engineer/prompt";
import type { EngineerMessageContextSnapshot, PersistedChatExchange } from "@/lib/engineer/types";

async function getOrCreateThread(params: {
  userId: string;
  threadId: string | null;
}): Promise<string> {
  if (params.threadId) {
    const existing = await prisma.engineerChatThread.findFirst({
      where: { id: params.threadId, userId: params.userId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }
  const created = await prisma.engineerChatThread.create({
    data: { userId: params.userId },
    select: { id: true },
  });
  return created.id;
}

export async function persistEngineerChatExchange(params: {
  userId: string;
  threadId: string | null;
  userQuestion: string;
  assistantReply: string;
  /** Old clients may still send these; they land in the rating snapshot and nowhere else. */
  runId?: string;
  compareRunId?: string;
  source?: string;
  promptVersion?: string;
}): Promise<PersistedChatExchange> {
  const threadId = await getOrCreateThread({
    userId: params.userId,
    threadId: params.threadId,
  });

  const ratingContext: EngineerMessageContextSnapshot = {
    question: params.userQuestion.slice(0, 4096),
    answer: params.assistantReply.slice(0, 8192),
    runId: params.runId?.trim() || null,
    compareRunId: params.compareRunId?.trim() || null,
    source: params.source,
    promptVersion: params.promptVersion ?? ENGINEER_PROMPT_VERSION,
  };

  await prisma.engineerChatMessage.create({
    data: {
      threadId,
      role: "user",
      content: params.userQuestion.slice(0, 4096),
    },
  });

  const assistant = await prisma.engineerChatMessage.create({
    data: {
      threadId,
      role: "assistant",
      content: params.assistantReply.slice(0, 16384),
      metadataJson: ratingContext,
    },
    select: { id: true },
  });

  await prisma.engineerChatThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  return {
    threadId,
    assistantMessageId: assistant.id,
    ratingContext,
  };
}

export async function userCanAccessEngineerMessage(userId: string, messageId: string): Promise<boolean> {
  const row = await prisma.engineerChatMessage.findFirst({
    where: {
      id: messageId,
      thread: { userId },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export function contextSnapshotFromMessageMetadata(
  metadataJson: unknown,
  fallback: EngineerMessageContextSnapshot
): EngineerMessageContextSnapshot {
  if (!metadataJson || typeof metadataJson !== "object") return fallback;
  return { ...fallback, ...(metadataJson as EngineerMessageContextSnapshot) };
}
