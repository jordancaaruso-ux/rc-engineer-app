import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  generateEngineerChatReply,
  type EngineerChatMessage,
} from "@/lib/engineerChat/runChatTurn";
import { loadEngineerLabRungs } from "@/lib/engineerChat/lab/labFlags";
import {
  buildEngineerLabFactBlocks,
  labRunIdFromAnchor,
} from "@/lib/engineerChat/lab/factBlocks";
import { engineerLabPromptVersion } from "@/lib/engineerChat/prompt";
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

/**
 * Fields the client sends. Most are now IGNORED — v0 of the Engineer (2026-08-05) sends the
 * model the knowledge base, a five-sentence prompt and the conversation, and nothing else. The
 * client still computes and posts the run/pattern/pace payloads; they are dropped here rather
 * than in the client so old app builds keep working. Clearing them out of the client is a
 * separate tidy-up.
 */
type ChatRequestBody = {
  messages?: Array<{ role?: unknown; content?: unknown }>;
  /** Stamped on the persisted exchange so the thread still records what was on screen. */
  runId?: unknown;
  compareRunId?: unknown;
  /** Still parsed: it guards the lap-history path and labels the persisted thread. */
  anchor?: unknown;
  /** Used only by the deterministic lap-history answer below. */
  timeZone?: unknown;
  stream?: unknown;
  threadId?: unknown;
  /** Ignored. Old clients still send these; v0 has no context to put them in. */
  includePatternDigest?: boolean;
  patternDigest?: unknown;
  includeRunCatalog?: boolean;
  paceVsFieldRunDigest?: unknown;
  paceVsFieldRunDigestSubset?: unknown;
  /** Ignored — the quick/normal/deep mode system is retired (2026-07-29). */
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
  promptVersion?: string;
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
      promptVersion: params.promptVersion,
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
      const feedback = await maybePersistEngineerReply({
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

    // Engineer lab (admin-only, every rung off by default — see lib/engineerChat/lab/labFlags.ts).
    // For every other account this resolves to no rungs and no blocks, and the request below is
    // byte-for-byte the shipped one. Failures here must never cost someone their answer, so a
    // broken rung degrades to the shipped Engineer rather than throwing.
    const labRungs = await loadEngineerLabRungs({ userId: user.id, email: user.email }).catch(
      () => []
    );
    const factBlocks =
      labRungs.length > 0
        ? await buildEngineerLabFactBlocks({
            userId: user.id,
            runId: labRunIdFromAnchor(anchor, runId),
            rungs: labRungs,
          }).catch((err) => {
            console.error("[api/engineer/chat] lab fact blocks failed", err);
            return [] as string[];
          })
        : [];
    // Stamp what actually reached the model, not what was requested: a rung that produced no
    // facts (unanchored question, run with no setup sheet) leaves the answer identical to the
    // shipped one, and labelling it a lab answer would put a false variant in the rating batch.
    const promptVersion = engineerLabPromptVersion(factBlocks.length > 0 ? labRungs : []);

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
              factBlocks,
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
            const feedback = await maybePersistEngineerReply({
              userId: user.id,
              body,
              messages,
              reply: out.reply,
              contextJson: null,
              resolvedFocus: null,
              runId,
              compareRunId,
              source: "llm",
              anchor,
              promptVersion,
            });
            send("done", {
              reply: out.reply,
              resolvedFocus: null,
              anchor: anchor ? { ...anchor, label: null } : null,
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

    const out = await generateEngineerChatReply({ messages, factBlocks });

    await recordAiUsage({
      userId: user.id,
      feature: "engineer-chat",
      model: out.model,
      promptTokens: out.usage?.promptTokens ?? 0,
      completionTokens: out.usage?.completionTokens ?? 0,
      cachedPromptTokens: out.usage?.cachedPromptTokens ?? 0,
    });

    const feedback = await maybePersistEngineerReply({
      userId: user.id,
      body,
      messages,
      reply: out.reply,
      contextJson: null,
      resolvedFocus: null,
      runId,
      compareRunId,
      source: "llm",
      anchor,
      promptVersion,
    });

    return NextResponse.json({
      contextJson: null,
      reply: out.reply,
      resolvedFocus: null,
      anchor: anchor ? { ...anchor, label: null } : null,
      feedback,
    });
  } catch (err) {
    console.error("[api/engineer/chat]", err);
    const { message, debug } = exceptionToClientPayload(err);
    return jsonError(500, message, debug);
  }
}
