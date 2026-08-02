import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import type { EngineerChatMessage } from "@/lib/engineerPhase5/openaiEngineer";
import {
  buildEngineerChatContext,
  buildMergeContextWithFocusedPair,
  pinnedAnchorForModel,
} from "@/lib/engineerPhase5/engineerChatPipeline";
import { generateEngineerChatReplyWithTools } from "@/lib/engineerPhase5/openaiEngineer";
import { tryAnswerLapHistoryQuery } from "@/lib/engineerPhase5/lapHistoryQuery";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { checkAiBudget, engineerQuotaSnapshot, recordAiUsage } from "@/lib/aiUsage/ledger";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { clientIpKey } from "@/lib/clientIp";
import { persistEngineerChatExchange } from "@/lib/engineerFeedback/persistExchange";
import type { EngineerMessageContextSnapshot } from "@/lib/engineerFeedback/types";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";
import { parseChatAnchor, type EngineerChatAnchor } from "@/lib/engineerPhase5/engineerAnchor";

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
  /** Explicit anchor (EngineerChatAnchor). A pinned one is a hard subject; wins over runId/compareRunId. */
  anchor?: unknown;
  includePatternDigest?: boolean;
  patternDigest?: unknown;
  includeRunCatalog?: boolean;
  timeZone?: unknown;
  paceVsFieldRunDigest?: unknown;
  paceVsFieldRunDigestSubset?: unknown;
  stream?: unknown;
  threadId?: unknown;
  /** Ignored — the quick/normal/deep mode system is retired (2026-07-29). Old clients may still send it. */
  mode?: unknown;
};

type EngineerChatFeedbackPayload = {
  threadId: string;
  assistantMessageId: string;
  ratingContext: EngineerMessageContextSnapshot;
};

async function maybePersistEngineerReply(params: {
  userId: string;
  body: ChatRequestBody | null;
  messages: EngineerChatMessage[];
  reply: string;
  contextJson: unknown | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  runId: string;
  compareRunId: string;
  source?: string;
  anchor?: EngineerChatAnchor | null;
  anchorLabel?: string | null;
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
      anchor: params.anchor ?? null,
      anchorLabel: params.anchorLabel ?? null,
    });
    // Gold-set auto-capture disconnected 2026-07-30 (founder call): the founder reviews
    // answers directly via in-app ratings + notes for now. The candidate lib, admin API
    // routes, and eval scripts stay in the tree — re-adding captureFounderGoldSetCandidate
    // here (and EngineerGoldSetAdminSection in settings) turns it all back on.
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

    // Demo mode (MONETISATION_NORTH_STAR.md Phase 3): the one write a demo session may make.
    // Per-IP cap below; the shared demo userId also flows through checkAiBudget, whose
    // AiUsageDaily row doubles as a DB-backed GLOBAL demo ceiling. Persistence is skipped so
    // live questions never pollute the curated thread history.
    const isDemo = isDemoIdentity({ id: user.id, email: user.email });

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
    const anchor = parseChatAnchor(body?.anchor);
    const useStream = body?.stream === true;
    const timeZone =
      typeof body?.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : "UTC";

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    // A pinned anchor skips the deterministic lap-history path entirely: that path knows
    // nothing about anchors, and "these laps" must mean the pinned subject, not a track query.
    const lapHistoryAnswer = anchor?.pinned
      ? null
      : await tryAnswerLapHistoryQuery({
          userId: user.id,
          message: lastUserMsg,
          messages,
          timeZone,
        });
    if (lapHistoryAnswer) {
      const feedback = isDemo
        ? null
        : await maybePersistEngineerReply({
            userId: user.id,
            body,
            messages,
            reply: lapHistoryAnswer.reply,
            contextJson: null,
            resolvedFocus: null,
            runId,
            compareRunId,
            source: "lap_history",
            anchor,
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
            // Status frames are the whole point of this stream; a buffering proxy would
            // collapse a 60s answer back into one static label.
            "X-Accel-Buffering": "no",
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

    // Tire-comparison and planning questions used to short-circuit here to canned
    // markdown reports with no LLM — "going to <track>" was enough to route a driver
    // away from the Engineer entirely. Removed 2026-07-29 (Phase 2): those questions now
    // get the real Engineer with full context; the same data still reaches it via
    // conditionalSetupEmpirical and the compare_tires / tire_history_at_track tools.
    // Lap history above stays deterministic — it is genuinely a database read.

    // Budget check sits AFTER the deterministic route above — it answers from the DB and
    // costs nothing, so it must never burn a user's AI allowance.
    // Tier shaping (MONETISATION_NORTH_STAR.md Phase 2): a lapsed subscriber is blocked outright;
    // paying tiers get their allowance (Standard 2/day, Pro 300/mo); grandfathered/comped users
    // and dark enforcement keep the base budget untouched.
    // Streaming clients only understand error FRAMES, so refusals ship as a 200 SSE stream with
    // one error event; plain clients get real status codes.
    const refuseAllowance = (message: string, status: number): Response => {
      if (useStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            // Status frames are the whole point of this stream; a buffering proxy would
            // collapse a 60s answer back into one static label.
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      }
      return NextResponse.json({ error: message }, { status });
    };

    // Demo visitors: 2 live questions a day per IP, plus a DURABLE global ceiling on the shared
    // demo account (15/day · 100/month — founder wants this very limited, 2026-08-02). The
    // per-IP brake is in-memory best-effort on serverless; the snapshot query is the one that
    // actually bounds spend. Placed AFTER the free deterministic lap-history path so a database
    // answer never burns a question, and BEFORE the budget block so refusals stay friendly.
    if (isDemo) {
      const demoRl = checkApiRateLimit({
        key: `engineer-chat-demo:${clientIpKey(request)}`,
        limit: 2,
        windowMs: 24 * 60 * 60 * 1000,
      });
      if (!demoRl.ok) {
        return refuseAllowance(
          "That's both demo questions for today. In the full app, the Engineer answers all day — about your own car, not the demo driver's. Get your own garage at jrcdynamics.com/join.",
          429,
        );
      }
      const demoUsage = await engineerQuotaSnapshot(user.id);
      if (demoUsage.today >= 15 || demoUsage.month >= 100) {
        return refuseAllowance(
          "The demo Engineer has answered a lot today — come back tomorrow, or get your own garage and ask about your own car.",
          429,
        );
      }
    }

    const entitlement = await getEntitlement(user);
    if (isBillingEnforced() && !entitlement.entitled) {
      return refuseAllowance(
        "Your subscription has ended — renew on the Subscription page to keep asking the Engineer.",
        402,
      );
    }
    const tier =
      isBillingEnforced() &&
      !entitlement.grandfathered &&
      (entitlement.tier === "standard" || entitlement.tier === "pro")
        ? entitlement.tier
        : undefined;
    const budget = await checkAiBudget({
      userId: user.id,
      userEmail: user.email,
      feature: "engineer-chat",
      tier,
    });
    if (!budget.ok) {
      return refuseAllowance(budget.message, 429);
    }

    if (useStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
              );
            } catch {
              // Client went away mid-stream. Swallow it — otherwise the catch below tries to
              // send an error frame down the same dead stream and throws out of start().
            }
          };
          try {
            send("status", { phase: "preparing" });
            const built = await buildEngineerChatContext({
              userId: user.id,
              body,
              messages,
              runId,
              compareRunId,
              anchor,
              timeZone,
              onStage: (phase) => send("status", { phase }),
            });
            if ("error" in built) {
              send("error", { message: built.error ?? "Run not found" });
              return;
            }
            const { contextJson, baseForMerge, lastUser, contextTier, anchorLabel } = built;
            const mergeContextWithFocusedPair = buildMergeContextWithFocusedPair({
              userId: user.id,
              baseForMerge,
              lastUser,
              timeZone,
            });
            send("status", { phase: "thinking" });
            const out = await generateEngineerChatReplyWithTools({
              contextJson,
              messages,
              userId: user.id,
              mergeContextWithFocusedPair,
              contextTier,
              timeZone,
              pinnedAnchor: pinnedAnchorForModel(anchor, anchorLabel),
              onStatus: (phase) => send("status", { phase }),
              onToken: (t) => send("token", { t }),
            });
            await recordAiUsage({
              userId: user.id,
              feature: "engineer-chat",
              model: out.model,
              promptTokens: out.usage?.promptTokens ?? 0,
              completionTokens: out.usage?.completionTokens ?? 0,
              cachedPromptTokens: out.usage?.cachedPromptTokens ?? 0,
            });
            const feedback = isDemo
              ? null
              : await maybePersistEngineerReply({
                  userId: user.id,
                  body,
                  messages,
                  reply: out.reply,
                  contextJson: out.contextJson,
                  resolvedFocus: out.resolvedFocus,
                  runId,
                  compareRunId,
                  source: "llm",
                  anchor,
                  anchorLabel,
                });
            send("done", {
              reply: out.reply,
              resolvedFocus: out.resolvedFocus,
              anchor: anchor ? { ...anchor, label: anchorLabel } : null,
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
          // Status frames are the whole point of this stream; a buffering proxy would
          // collapse a 60s answer back into one static label.
          "X-Accel-Buffering": "no",
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
      anchor,
      timeZone,
    });
    if ("error" in built) {
      return jsonError(404, built.error ?? "Run not found");
    }
    const { contextJson, baseForMerge, lastUser, contextTier, anchorLabel } = built;
    const mergeContextWithFocusedPair = buildMergeContextWithFocusedPair({
      userId: user.id,
      baseForMerge,
      lastUser,
      timeZone,
    });

    const out = await generateEngineerChatReplyWithTools({
      contextJson,
      messages,
      userId: user.id,
      mergeContextWithFocusedPair,
      contextTier,
      timeZone,
      pinnedAnchor: pinnedAnchorForModel(anchor, anchorLabel),
    });

    await recordAiUsage({
      userId: user.id,
      feature: "engineer-chat",
      model: out.model,
      promptTokens: out.usage?.promptTokens ?? 0,
      completionTokens: out.usage?.completionTokens ?? 0,
      cachedPromptTokens: out.usage?.cachedPromptTokens ?? 0,
    });

    const feedback = isDemo
      ? null
      : await maybePersistEngineerReply({
          userId: user.id,
          body,
          messages,
          reply: out.reply,
          contextJson: out.contextJson,
          resolvedFocus: out.resolvedFocus,
          runId,
          compareRunId,
          source: "llm",
          anchor,
          anchorLabel,
        });

    return NextResponse.json({
      contextJson: out.contextJson,
      reply: out.reply,
      resolvedFocus: out.resolvedFocus,
      anchor: anchor ? { ...anchor, label: anchorLabel } : null,
      feedback,
    });
  } catch (err) {
    console.error("[api/engineer/chat]", err);
    const { message, debug } = exceptionToClientPayload(err);
    return jsonError(500, message, debug);
  }
}
