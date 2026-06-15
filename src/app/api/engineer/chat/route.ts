import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  buildEngineerContextPacketV1,
  buildFocusedRunPairContext,
} from "@/lib/engineerPhase5/contextPacket";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import { engineerChatNeedsDeepContext, engineerChatContextTier } from "@/lib/engineerPhase5/engineerChatContextTier";
import { tryAnswerLapHistoryQuery } from "@/lib/engineerPhase5/lapHistoryQuery";
import { getOrComputeEngineerSummaryForLatestRun } from "@/lib/engineerPhase5/loadLatestEngineerSummary";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import {
  generateEngineerChatReplyWithTools,
  type EngineerChatMessage,
} from "@/lib/engineerPhase5/openaiEngineer";
import { buildRunCatalogV1 } from "@/lib/engineerPhase5/runCatalog";
import { buildTireLifePriorsForChatContext } from "@/lib/engineerPhase5/tireLifePriors/computeTireLifePriors";
import { buildSetupHandlingPaceBundle } from "@/lib/engineerPhase5/setupHandlingPaceBundle";
import { buildSetupOutcomeMemoryForRun } from "@/lib/engineerPhase5/setupOutcomeMemory";
import { buildEngineeringBrainV1 } from "@/lib/engineerPhase5/engineeringBrain";
import {
  parsePaceVsFieldRunDigestPayload,
  parsePaceVsFieldRunDigestSubsetPayload,
} from "@/lib/engineerPhase5/paceVsFieldRunDigestParse";
import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { perfSpan } from "@/lib/perfLog";

const MAX_MESSAGE_CHARS = 4096;

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function focusedPairForTirePriors(
  focused: null | Awaited<ReturnType<typeof buildFocusedRunPairContext>>
): null | {
  primaryTireRun: number;
  compareTireRun: number | null;
  sameTireSet: boolean;
} {
  if (!focused) return null;
  if (!focused.compare) {
    return {
      primaryTireRun: focused.primary.tireRunNumber,
      compareTireRun: null,
      sameTireSet: true,
    };
  }
  return {
    primaryTireRun: focused.primary.tireRunNumber,
    compareTireRun: focused.compare.tireRunNumber,
    sameTireSet: focused.pairingParity?.sameTireSet ?? false,
  };
}

function jsonError(status: number, message: string, debug?: string) {
  const payload: { error: string; debug?: string } = { error: message };
  if (debug) payload.debug = debug;
  return NextResponse.json(payload, { status });
}

function exceptionToClientPayload(err: unknown): { message: string; debug?: string } {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Engineer chat failed";
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
};

type BuiltChatContext =
  | { error: string }
  | {
      contextJson: Record<string, unknown>;
      baseForMerge: Record<string, unknown>;
      lastUser: EngineerChatMessage | undefined;
      needsDeep: boolean;
      contextTier: "light" | "full";
    };

async function buildEngineerChatContext(params: {
  userId: string;
  body: ChatRequestBody | null;
  messages: EngineerChatMessage[];
  runId: string;
  compareRunId: string;
}): Promise<BuiltChatContext> {
  return perfSpan("buildEngineerChatContext", async () => {
    const { userId, body, messages, runId, compareRunId } = params;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const needsDeep = engineerChatNeedsDeepContext({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
    });
    const contextTier = engineerChatContextTier({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
    });

    const [basePacket, focusedRunPair] = await Promise.all([
      perfSpan("buildEngineerContextPacketV1", () => buildEngineerContextPacketV1(userId)),
      runId
        ? perfSpan("buildFocusedRunPairContext", () =>
            buildFocusedRunPairContext(userId, runId, compareRunId || null)
          )
        : Promise.resolve(null),
    ]);

    if (runId && !focusedRunPair) {
      return { error: "Run not found" };
    }

    const anchorForRichContext = runId || basePacket.latestRun?.id || null;

    const richEngineerContext =
      lastUser && typeof lastUser.content === "string"
        ? await perfSpan("buildEngineerRichContextV1", () =>
            buildEngineerRichContextV1({
              userId,
              anchorRunId: anchorForRichContext,
              lastUserMessage: lastUser.content,
              opts: needsDeep
                ? { spreadDepth: "full", kbLimit: 10 }
                : { spreadDepth: "none", kbLimit: 5, skipFieldStats: true },
            })
          )
        : null;

    const patternDigest =
      body?.includePatternDigest === true &&
      body?.patternDigest &&
      typeof body.patternDigest === "object" &&
      body.patternDigest !== null
        ? body.patternDigest
        : null;

    const includeRunCatalog = body?.includeRunCatalog === true;
    const paceVsFieldRunDigest = parsePaceVsFieldRunDigestPayload(body?.paceVsFieldRunDigest);
    const paceVsFieldRunDigestSubset = parsePaceVsFieldRunDigestSubsetPayload(
      body?.paceVsFieldRunDigestSubset
    );

    const brainCarId = richEngineerContext?.car?.id ?? focusedRunPair?.primary.carId ?? null;
    const brainAnchor = anchorForRichContext;

    const [
      summaryResult,
      tireLifePriors,
      setupOutcomeMemory,
      engineeringBrain,
      runCatalog,
    ] = await Promise.all([
      needsDeep
        ? !focusedRunPair
          ? perfSpan("getOrComputeEngineerSummaryForLatestRun", () =>
              getOrComputeEngineerSummaryForLatestRun(userId)
            )
          : !compareRunId
            ? perfSpan("getOrComputeEngineerSummaryForRun", () =>
                getOrComputeEngineerSummaryForRun(userId, focusedRunPair.primaryRunId)
              )
            : Promise.resolve(null)
        : Promise.resolve(null),
      needsDeep
        ? perfSpan("buildTireLifePriorsForChatContext", () =>
            buildTireLifePriorsForChatContext({
              userId,
              anchorRunId: anchorForRichContext,
              focusedPair: focusedPairForTirePriors(focusedRunPair),
            })
          )
        : Promise.resolve(null),
      needsDeep
        ? perfSpan("buildSetupOutcomeMemoryForRun", () =>
            buildSetupOutcomeMemoryForRun({
              userId,
              anchorRunId: anchorForRichContext,
              carId: richEngineerContext?.car?.id ?? focusedRunPair?.primary.carId ?? null,
            }).catch(() => null)
          )
        : Promise.resolve(null),
      needsDeep && brainCarId && brainAnchor
        ? perfSpan("buildEngineeringBrainV1", () =>
            buildEngineeringBrainV1({
              userId,
              carId: brainCarId,
              anchorRunId: brainAnchor,
              referenceRunId: focusedRunPair?.compare?.id ?? null,
            }).catch(() => null)
          )
        : Promise.resolve(null),
      includeRunCatalog ? buildRunCatalogV1({ userId }) : Promise.resolve(null),
    ]);

    const engineerSummary: EngineerRunSummaryV2 | null = summaryResult?.summary ?? null;
    const setupHandlingPaceBundle = needsDeep ? buildSetupHandlingPaceBundle(focusedRunPair) : null;

    const contextJson: Record<string, unknown> = {
      contextTier,
      defaultDashboardContext: basePacket,
      engineerSummary,
      richEngineerContext,
      resolvedRunScope: null,
      focusedRunPair,
      patternDigest,
      runCatalog,
      tireLifePriors,
      setupHandlingPaceBundle,
      setupOutcomeMemory,
      engineeringBrain,
      resolvedScopeTireSteps: null,
      thingsToTry: basePacket.thingsToTry,
      thingsToDo: basePacket.thingsToDo,
      paceVsFieldRunDigest,
      paceVsFieldRunDigestSubset,
    };

    const baseForMerge: Record<string, unknown> = {
      contextTier,
      defaultDashboardContext: basePacket,
      resolvedRunScope: null,
      patternDigest,
      runCatalog,
      tireLifePriors,
      resolvedScopeTireSteps: null,
      setupHandlingPaceBundle,
      setupOutcomeMemory,
      engineeringBrain,
      thingsToTry: basePacket.thingsToTry,
      thingsToDo: basePacket.thingsToDo,
      paceVsFieldRunDigest,
      paceVsFieldRunDigestSubset,
    };

    return {
      contextJson,
      baseForMerge,
      lastUser,
      needsDeep,
      contextTier,
    };
  });
}

function buildMergeContextWithFocusedPair(opts: {
  userId: string;
  baseForMerge: Record<string, unknown>;
  lastUser: EngineerChatMessage | undefined;
}) {
  return async (focused: NonNullable<Awaited<ReturnType<typeof buildFocusedRunPairContext>>>) => {
    const [summaryResult, rich, reTire, reSetupOutcomeMemory, reEngineeringBrain] = await Promise.all([
      !focused.compareRunId
        ? getOrComputeEngineerSummaryForRun(opts.userId, focused.primaryRunId)
        : Promise.resolve(null),
      opts.lastUser && typeof opts.lastUser.content === "string"
        ? buildEngineerRichContextV1({
            userId: opts.userId,
            anchorRunId: focused.primaryRunId,
            lastUserMessage: opts.lastUser.content,
            opts: { spreadDepth: "full", kbLimit: 10 },
          })
        : Promise.resolve(null),
      buildTireLifePriorsForChatContext({
        userId: opts.userId,
        anchorRunId: focused.primaryRunId,
        focusedPair: focusedPairForTirePriors(focused),
      }),
      buildSetupOutcomeMemoryForRun({
        userId: opts.userId,
        anchorRunId: focused.primaryRunId,
        carId: focused.primary.carId,
      }).catch(() => null),
      focused.primary.carId
        ? buildEngineeringBrainV1({
            userId: opts.userId,
            carId: focused.primary.carId,
            anchorRunId: focused.primaryRunId,
            referenceRunId: focused.compare?.id ?? null,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      ...opts.baseForMerge,
      contextTier: "full",
      engineerSummary: summaryResult?.summary ?? null,
      focusedRunPair: focused,
      richEngineerContext: rich,
      tireLifePriors: reTire,
      setupHandlingPaceBundle: buildSetupHandlingPaceBundle(focused),
      setupOutcomeMemory: reSetupOutcomeMemory,
      engineeringBrain: reEngineeringBrain,
    };
  };
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
      userEmail: user.email,
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
      timeZone,
    });
    if (lapHistoryAnswer) {
      if (useStream) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };
            send("status", { phase: "done", source: "lap_history" });
            send("done", { reply: lapHistoryAnswer.reply, source: "lap_history" });
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
      });
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
            send("done", {
              reply: out.reply,
              resolvedFocus: out.resolvedFocus,
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

    return NextResponse.json({
      contextJson: out.contextJson,
      reply: out.reply,
      resolvedFocus: out.resolvedFocus,
    });
  } catch (err) {
    console.error("[api/engineer/chat]", err);
    const { message, debug } = exceptionToClientPayload(err);
    return jsonError(500, message, debug);
  }
}
