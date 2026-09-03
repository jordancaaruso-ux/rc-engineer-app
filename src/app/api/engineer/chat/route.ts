import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import { generateEngineerChatReply } from "@/lib/engineer/chat";
import { buildDriverDataBlocks } from "@/lib/engineer/driverData";
import type { EngineerChatMessage } from "@/lib/engineer/payload";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { checkAiBudget, engineerQuotaSnapshot, recordAiUsage } from "@/lib/aiUsage/ledger";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { clientIpKey } from "@/lib/clientIp";
import { persistEngineerChatExchange } from "@/lib/engineer/persistExchange";
import type { EngineerMessageContextSnapshot } from "@/lib/engineer/types";
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

/**
 * Fields the client sends. Most are IGNORED, deliberately and forever tolerated: stale app
 * builds, installed PWAs and the iOS shell keep POSTing the old-era fields (`anchor`,
 * `patternDigest`, `mode`, …), and an unknown field must never 400 an answer. The Engineer
 * sends the model the knowledge base, a short prompt and the conversation, and nothing else
 * (docs/ENGINEER_NORTH_STAR.md).
 */
type ChatRequestBody = {
  messages?: Array<{ role?: unknown; content?: unknown }>;
  /** Stamped on the persisted exchange so the thread still records what was on screen. */
  runId?: unknown;
  compareRunId?: unknown;
  stream?: unknown;
  threadId?: unknown;
  /** Ignored — old clients still send these. */
  anchor?: unknown;
  timeZone?: unknown;
  includePatternDigest?: boolean;
  patternDigest?: unknown;
  includeRunCatalog?: boolean;
  paceVsFieldRunDigest?: unknown;
  paceVsFieldRunDigestSubset?: unknown;
  /**
   * `"general"` = attach NO driver data — the subject bar's General segment (founder call
   * 2026-09-03). It is the request a driver with no runs already gets, not a new shape. Every
   * other value is an old-era mode and is ignored.
   */
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
  runId: string;
  compareRunId: string;
  source?: string;
}): Promise<EngineerChatFeedbackPayload | null> {
  const userQuestion = [...params.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (!userQuestion.trim() || !params.reply.trim()) return null;
  const threadId = typeof params.body?.threadId === "string" ? params.body.threadId.trim() : null;
  try {
    return await persistEngineerChatExchange({
      userId: params.userId,
      threadId: threadId || null,
      userQuestion,
      assistantReply: params.reply,
      runId: params.runId,
      compareRunId: params.compareRunId,
      source: params.source,
    });
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

    /*
     * The demo never asks (MONETISATION_NORTH_STAR.md, "The demo's clock"). Founder call
     * 2026-08-25 replaced two live questions a visitor with a curated history of answers already
     * given, so `/api/engineer/chat` came off the demo write allowlist and middleware refuses
     * this request before it arrives.
     *
     * This is the second lock on the same door, and it is FIRST in the handler on purpose. The
     * middleware's lock is a path string in a Set — rename this route, add an alias, mount it
     * under a rewrite, and the match quietly stops matching while the handler carries on
     * answering. Identity cannot drift that way. Ahead of the deterministic lap-history path
     * too, which is free but is still an answer, and the demo gives none.
     */
    const isDemo = isDemoIdentity({ id: user.id, email: user.email });
    if (isDemo) {
      return NextResponse.json(
        {
          error:
            "The demo shows answers the Engineer has already given. Get your own garage to ask about your own car.",
        },
        { status: 403 },
      );
    }

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
    const generalMode = body?.mode === "general";
    const useStream = body?.stream === true;

    // Streaming clients only understand error FRAMES, so refusals ship as a 200 SSE stream
    // with one error event; plain clients get real status codes.
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

    // Demo visitors: 2 live questions a day per IP, plus a DURABLE global ceiling on the
    // shared demo account (15/day · 100/month — founder wants this very limited, 2026-08-02).
    // The per-IP brake is in-memory best-effort on serverless; the snapshot query is the one
    // that actually bounds spend.
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

    // Tier shaping (MONETISATION_NORTH_STAR.md Phase 2): a lapsed subscriber is blocked
    // outright; paying tiers get their allowance (Standard 2/day, Pro 300/mo);
    // grandfathered/comped users and dark enforcement keep the base budget untouched.
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

    // The driver's own data rides along on every turn: an explicit runId from the client
    // wins (a pinned run, or an old-era client), otherwise their latest run. A driver with no
    // runs gets [] and the request is byte-identical to the data-less one — and General asks
    // for exactly that request on purpose (theory only, nothing from the logs attached).
    const driverBlocks = generalMode
      ? []
      : await buildDriverDataBlocks({
          userId: user.id,
          runId: runId || null,
        }).catch(() => []);

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
            send("status", { phase: "thinking" });
            const out = await generateEngineerChatReply({
              messages,
              driverBlocks,
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
                  runId,
                  compareRunId,
                  source: "llm",
                });
            send("done", {
              reply: out.reply,
              resolvedFocus: null,
              anchor: null,
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

    const out = await generateEngineerChatReply({ messages, driverBlocks });

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
          runId,
          compareRunId,
          source: "llm",
        });

    return NextResponse.json({
      contextJson: null,
      reply: out.reply,
      resolvedFocus: null,
      anchor: null,
      feedback,
    });
  } catch (err) {
    console.error("[api/engineer/chat]", err);
    const { message, debug } = exceptionToClientPayload(err);
    return jsonError(500, message, debug);
  }
}
