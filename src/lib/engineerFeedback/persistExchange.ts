import "server-only";

import { prisma } from "@/lib/prisma";
import { buildEngineerResponseMetadata } from "@/lib/engineerFeedback/extractResponseMetadata";
import { ENGINEER_PROMPT_VERSION } from "@/lib/engineerChat/prompt";
import type { EngineerMessageContextSnapshot, PersistedChatExchange } from "@/lib/engineerFeedback/types";
import {
  resolveThreadFocusForPersist,
  type EngineerChatAnchor,
  type EngineerThreadFocusAnchorV1,
} from "@/lib/engineerPhase5/engineerAnchor";

async function getOrCreateThread(params: {
  userId: string;
  threadId: string | null;
  primaryRunId: string | null;
  compareRunId: string | null;
  focusAnchorJson: EngineerThreadFocusAnchorV1 | null;
}): Promise<string> {
  if (params.threadId) {
    const existing = await prisma.engineerChatThread.findFirst({
      where: { id: params.threadId, userId: params.userId },
      select: { id: true },
    });
    if (existing) {
      await prisma.engineerChatThread.update({
        where: { id: existing.id },
        data: {
          primaryRunId: params.primaryRunId,
          compareRunId: params.compareRunId,
          focusAnchorJson: params.focusAnchorJson ?? undefined,
        },
      });
      return existing.id;
    }
  }
  const created = await prisma.engineerChatThread.create({
    data: {
      userId: params.userId,
      primaryRunId: params.primaryRunId,
      compareRunId: params.compareRunId,
      focusAnchorJson: params.focusAnchorJson ?? undefined,
    },
    select: { id: true },
  });
  return created.id;
}


export async function persistEngineerChatExchange(params: {
  userId: string;
  threadId: string | null;
  userQuestion: string;
  assistantReply: string;
  contextJson: unknown | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  runId?: string;
  compareRunId?: string;
  source?: string;
  /** Explicit anchor from the chat request; a pinned one beats resolvedFocus. */
  anchor?: EngineerChatAnchor | null;
  anchorLabel?: string | null;
  /**
   * Which Engineer produced this. Defaults to the shipped one; the Engineer lab passes its own
   * so private variant answers never join the shipped version's rating batch.
   */
  promptVersion?: string;
}): Promise<PersistedChatExchange> {
  const focus = resolveThreadFocusForPersist({
    anchor: params.anchor ?? null,
    anchorLabel: params.anchorLabel,
    resolvedFocus: params.resolvedFocus,
    runId: params.runId,
    compareRunId: params.compareRunId,
  });
  const threadId = await getOrCreateThread({
    userId: params.userId,
    threadId: params.threadId,
    primaryRunId: focus.primaryRunId,
    compareRunId: focus.compareRunId,
    focusAnchorJson: focus.focusAnchorJson,
  });

  const ratingContext = buildEngineerResponseMetadata({
    question: params.userQuestion,
    answer: params.assistantReply,
    contextJson: params.contextJson,
    resolvedFocus: params.resolvedFocus,
    runId: params.runId,
    compareRunId: params.compareRunId,
    source: params.source,
    promptVersion: params.promptVersion ?? ENGINEER_PROMPT_VERSION,
  });

  const metadataJson: EngineerMessageContextSnapshot = ratingContext;

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
      metadataJson,
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
