import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerChatMessage } from "@/lib/engineerPhase5/openaiEngineer";
import {
  buildEngineerChatContext,
  buildMergeContextWithFocusedPair,
} from "@/lib/engineerPhase5/engineerChatPipeline";
import { generateEngineerChatReplyWithTools } from "@/lib/engineerPhase5/openaiEngineer";
import { tryAnswerLapHistoryQuery } from "@/lib/engineerPhase5/lapHistoryQuery";
import {
  tryAnswerComparisonQuery,
  tryAnswerPlanningQuery,
} from "@/lib/engineerPhase5/reasoningSpine/deterministicRoutes";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { persistEngineerChatExchange } from "@/lib/engineerFeedback/persistExchange";
import { captureFounderGoldSetCandidate } from "@/lib/engineerFeedback/goldSetCandidate";
import type { EngineerMessageContextSnapshot } from "@/lib/engineerFeedback/types";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";

const MAX_MESSAGE_CHARS = 4096;

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(status: number, message: string, debug?: string) {
  const payload: { error: string; debug?: string } = { error: message };
  if (debug) payload.debug = debug;
  return NextResponse.json(payload, { status });
}

function exceptionToClientPayload(err: unknown): { message: string; debug?: string } {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Engineer chat failed";
  const message = engineerOpenAiUserMessage(raw) || "Engineer chat failed";
  const showStack =
    process.env.NODE_ENV === "development" || process.env.DEBUG_ENGINEER_CHAT === "1";
  const debug =
    showStack && err instanceof Error && err.stack ? err.stack.slice(0, 4000) : undefined;
  return { message: message || "Engineer chat failed", debug };
}

type ChatRequestBody = {
  messages?: Array<{ role?: unknown; content?: unknown }>;
  runId?: unknown;
  compareRunId?: unknown;
  includePatternDigest?: unknown;
  patternDigest?: unknown;
  includeRunCatalog?: unknown;
  timeZone?: unknown;
  paceVsFieldRunDigest?: unknown;
  paceVsFieldRunDigestSubset?: unknown;
  stream?: unknown;
  threadId?: unknown;
};

type EngineerChatFeedbackPayload = {
  threadId: string;
  assistantMessageId: string;
  ratingContext: EngineerMessageContextSnapshot;
};

async function maybePersistEngineerReply(params: {
  userId: string;
  userEmail: string | null | undefined;
  body: ChatRequestBody | null;
  messages: EngineerChatMessage[];
  reply: string;
  contextJson: unknown | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  runId: string;
  compareRunId: string;
  source?: string;
}): Promise<EngineerChatFeedbackPayload | null> {
  const userQuestion = [...params.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!userQuestion.trim() || !params.reply.trim()) return null;
  const threadId = typeof params.body?.threadId === "string" ? params.body.threadId.trim() : null;
  try {
    const exchange = await persistEngineerChatExchange({
      userId: params.userId,
      threadId: threadId || null,
      userQuestion,
      assistantReply: params.reply,
      contextJson: params.contextJson,
      resolvedFocus: params.resolvedFocus,
      runId: params.runId,
      compareRunId: params.compareRunId,
      source: params.source,
    });
    try {
      await captureFounderGoldSetCandidate({
        userId: params.userId,
        userEmail: params.userEmail,
        exchange,
      });
    } catch (captureErr) {
      console.error("[api/engineer/chat] gold-set capture failed", captureErr);
    }
    return exchange;
  } catch (err) {
    console.error("[api/engineer/chat] persist exchange failed", err);
    return null;
  }
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return jsonError(500, "DATABASE_URL is not set");
  }
  if (!hasOpenAiApiKey()) {
    return jsonError(500, "OPENAI_API_KEY is not set");
  }

  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = checkApiRateLimit({
      key: `engineer-chat:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

    const body = (await request.json().catch(() => null)) as ChatRequestBody | null;
    const raw = Array.isArray(body?.messages) ? body!.messages : [];
    const messages: EngineerChatMessage[] = raw
      .map((m) => {
        const role: EngineerChatMessage["role"] = m?.role === "assistant" ? "assistant" : "user";
        const content =
          typeof m?.content === "string" ? m.content.slice(0, MAX_MESSAGE_CHARS) : "";
        return { role, content };
      })
      .filter((m) => m.content.trim().length > 0)
      .slice(-8);

    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const compareRunId = typeof body?.compareRunId === "string" ? body.compareRunId.trim() : "";
    const useStream = body?.stream === true;
    const timeZone =
      typeof body?.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : "UTC";

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lapHistoryAnswer = await tryAnswerLapHistoryQuery({
      userId: user.id,
      message: lastUserMsg,
      messages,
      timeZone,
    });
    if (lapHistoryAnswer) {
      const feedback = await maybePersistEngineerReply({
        userId: user.id,
        userEmail: user.email,
        body,
        messages,
        reply: lapHistoryAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        runId,
        compareRunId,
        source: "lap_history",
      });
      if (useStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };
            send("status", { phase: "done", source: "lap_history" });
            send("done", {
              reply: lapHistoryAnswer.reply,
              source: "lap_history",
              feedback,
            });
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }
      return NextResponse.json({
        reply: lapHistoryAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        source: "lap_history",
        feedback,
      });
    }

    const comparisonAnswer = await tryAnswerComparisonQuery({
      userId: user.id,
      message: lastUserMsg,
      timeZone,
    });
    if (comparisonAnswer) {
      const feedback = await maybePersistEngineerReply({
        userId: user.id,
        userEmail: user.email,
        body,
        messages,
        reply: comparisonAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        runId,
        compareRunId,
        source: comparisonAnswer.source,
      });
      const payload = {
        reply: comparisonAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        source: comparisonAnswer.source,
        feedback,
      };
      if (useStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };
            send("status", { phase: "done", source: comparisonAnswer.source });
            send("done", payload);
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }
      return NextResponse.json(payload);
    }

    const planningAnswer = await tryAnswerPlanningQuery({
      userId: user.id,
      message: lastUserMsg,
      timeZone,
    });
    if (planningAnswer) {
      const feedback = await maybePersistEngineerReply({
        userId: user.id,
        userEmail: user.email,
        body,
        messages,
        reply: planningAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        runId,
        compareRunId,
        source: planningAnswer.source,
      });
      const payload = {
        reply: planningAnswer.reply,
        contextJson: null,
        resolvedFocus: null,
        source: planningAnswer.source,
        feedback,
      };
      if (useStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };
            send("status", { phase: "done", source: planningAnswer.source });
            send("done", payload);
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }
      return NextResponse.json(payload);
    }

    if (useStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          try {
            send("status", { phase: "preparing" });
            const built = await buildEngineerChatContext({
              userId: user.id,
              body,
              messages,
              runId,
              compareRunId,
            });
            if ("error" in built) {
              send("error", { message: built.error ?? "Run not found" });
              return;
            }
            const { contextJson, baseForMerge, lastUser, contextTier } = built;
            const mergeContextWithFocusedPair = buildMergeContextWithFocusedPair({
              userId: user.id,
              baseForMerge,
              lastUser,
            });
            send("status", { phase: "thinking" });
            const out = await generateEngineerChatReplyWithTools({
              contextJson,
              messages,
              userId: user.id,
              mergeContextWithFocusedPair,
              contextTier,
              onToken: (t) => send("token", { t }),
            });
            const feedback = await maybePersistEngineerReply({
              userId: user.id,
              userEmail: user.email,
              body,
              messages,
              reply: out.reply,
              contextJson: out.contextJson,
              resolvedFocus: out.resolvedFocus,
              runId,
              compareRunId,
              source: "llm",
            });
            send("done", {
              reply: out.reply,
              resolvedFocus: out.resolvedFocus,
              feedback,
            });
          } catch (err) {
            const { message } = exceptionToClientPayload(err);
            send("error", { message });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const built = await buildEngineerChatContext({
      userId: user.id,
      body,
      messages,
      runId,
      compareRunId,
    });
    if ("error" in built) {
      return jsonError(404, built.error ?? "Run not found");
    }
    const { contextJson, baseForMerge, lastUser, contextTier } = built;
    const mergeContextWithFocusedPair = buildMergeContextWithFocusedPair({
      userId: user.id,
      baseForMerge,
      lastUser,
    });

    const out = await generateEngineerChatReplyWithTools({
      contextJson,
      messages,
      userId: user.id,
      mergeContextWithFocusedPair,
      contextTier,
    });

    const feedback = await maybePersistEngineerReply({
      userId: user.id,
      userEmail: user.email,
      body,
      messages,
      reply: out.reply,
      contextJson: out.contextJson,
      resolvedFocus: out.resolvedFocus,
      runId,
      compareRunId,
      source: "llm",
    });

    return NextResponse.json({
      contextJson: out.contextJson,
      reply: out.reply,
      resolvedFocus: out.resolvedFocus,
      feedback,
    });
  } catch (err) {
    console.error("[api/engineer/chat]", err);
    const { message, debug } = exceptionToClientPayload(err);
    return jsonError(500, message, debug);
  }
}
