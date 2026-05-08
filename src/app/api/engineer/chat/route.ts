import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  buildEngineerContextPacketV1,
  buildFocusedRunPairContext,
} from "@/lib/engineerPhase5/contextPacket";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import { getOrComputeEngineerSummaryForLatestRun } from "@/lib/engineerPhase5/loadLatestEngineerSummary";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import {
  generateEngineerChatReplyWithTools,
  type EngineerChatMessage,
} from "@/lib/engineerPhase5/openaiEngineer";
import { buildRunCatalogV1 } from "@/lib/engineerPhase5/runCatalog";
import { resolveRunScopeForEngineerChat } from "@/lib/engineerPhase5/resolveEngineerRunScope";
import {
  buildTireLifePriorsForChatContext,
} from "@/lib/engineerPhase5/tireLifePriors/computeTireLifePriors";

export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return jsonError(500, "DATABASE_URL is not set");
  }
  if (!hasOpenAiApiKey()) {
    return jsonError(500, "OPENAI_API_KEY is not set");
  }

  try {
  // #region agent log
  const __dbgT0 = Date.now();
  const __dbgSend = (payload: Record<string, unknown>) => {
    fetch('http://127.0.0.1:7349/ingest/41177859-c46a-4945-9afc-e968b6564943', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '4f2a81' },
      body: JSON.stringify({ sessionId: '4f2a81', timestamp: Date.now(), ...payload }),
    }).catch(() => {});
  };
  // #endregion
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | {
        messages?: Array<{ role?: unknown; content?: unknown }>;
        runId?: unknown;
        compareRunId?: unknown;
        /** When true, server attaches patternDigest from the client (Compare & trend). Default off so chat stays independent. */
        includePatternDigest?: unknown;
        patternDigest?: unknown;
        /** When false, omit account run catalog from context (default: include). */
        includeRunCatalog?: unknown;
        /** IANA timezone for local-calendar run resolution (e.g. from Intl). */
        timeZone?: unknown;
      }
    | null;
  const raw = Array.isArray(body?.messages) ? body!.messages : [];
  const messages: EngineerChatMessage[] = raw
    .map((m) => {
      const role: EngineerChatMessage["role"] = m?.role === "assistant" ? "assistant" : "user";
      const content = typeof m?.content === "string" ? m.content : "";
      return { role, content };
    })
    .filter((m) => m.content.trim().length > 0)
    .slice(-8);

  const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
  const compareRunId = typeof body?.compareRunId === "string" ? body.compareRunId.trim() : "";
  const timeZone =
    typeof body?.timeZone === "string" && body.timeZone.trim().length > 0 ? body.timeZone.trim() : "UTC";

  // #region agent log
  const __dbgT_basePacket0 = Date.now();
  // #endregion
  const basePacket = await buildEngineerContextPacketV1(user.id);
  // #region agent log
  const __dbgT_basePacket = Date.now() - __dbgT_basePacket0;
  // #endregion

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const anchorForRichContext = runId || basePacket.latestRun?.id || null;
  // #region agent log
  const __dbgT_rich0 = Date.now();
  // #endregion
  const richEngineerContext =
    lastUser && typeof lastUser.content === "string"
      ? await buildEngineerRichContextV1({
          userId: user.id,
          anchorRunId: anchorForRichContext,
          lastUserMessage: lastUser.content,
        })
      : null;
  // #region agent log
  const __dbgT_rich = Date.now() - __dbgT_rich0;
  const __dbgT_scope0 = Date.now();
  // #endregion
  const resolvedRunScope =
    !runId && lastUser
      ? await resolveRunScopeForEngineerChat({
          userId: user.id,
          lastUserMessage: lastUser.content,
          timeZone,
        }).catch(() => null)
      : null;
  // #region agent log
  const __dbgT_scope = Date.now() - __dbgT_scope0;
  // #endregion

  let focusedRunPair = null as Awaited<ReturnType<typeof buildFocusedRunPairContext>>;
  if (runId) {
    focusedRunPair = await buildFocusedRunPairContext(user.id, runId, compareRunId || null);
    if (!focusedRunPair) {
      return jsonError(404, "Run not found");
    }
  }

  // #region agent log
  const __dbgT_summary0 = Date.now();
  let __dbgSummaryCached: boolean | null = null;
  let __dbgSummaryPath: string = "none";
  // #endregion

  let engineerSummary: EngineerRunSummaryV2 | null = null;
  if (!focusedRunPair) {
    const summaryResult = await getOrComputeEngineerSummaryForLatestRun(user.id);
    engineerSummary = summaryResult?.summary ?? null;
    __dbgSummaryPath = "latest";
    __dbgSummaryCached = summaryResult?.cached ?? null;
  } else if (focusedRunPair && !compareRunId) {
    const summaryResult = await getOrComputeEngineerSummaryForRun(user.id, focusedRunPair.primaryRunId);
    engineerSummary = summaryResult?.summary ?? null;
    __dbgSummaryPath = "focused";
    __dbgSummaryCached = summaryResult?.cached ?? null;
  } else if (focusedRunPair && compareRunId) {
    __dbgSummaryPath = "pair_explicit_compare";
  }

  // #region agent log
  const __dbgT_summary = Date.now() - __dbgT_summary0;
  // #endregion

  const patternDigest =
    body?.includePatternDigest === true &&
    body?.patternDigest &&
    typeof body.patternDigest === "object" &&
    body.patternDigest !== null
      ? body.patternDigest
      : null;

  const includeRunCatalog = body?.includeRunCatalog !== false;
  // #region agent log
  const __dbgT_catalog0 = Date.now();
  // #endregion
  const runCatalog = includeRunCatalog ? await buildRunCatalogV1({ userId: user.id }) : null;
  // #region agent log
  const __dbgT_catalog = Date.now() - __dbgT_catalog0;
  // #endregion

  const tireLifePriors = await buildTireLifePriorsForChatContext({
    userId: user.id,
    anchorRunId: anchorForRichContext,
    focusedPair: focusedPairForTirePriors(focusedRunPair),
  });

  const contextJson = {
    defaultDashboardContext: basePacket,
    engineerSummary,
    /** Car, class, tires, track, setup vs template spread, retrieved vehicle-dynamics KB. */
    richEngineerContext,
    /** Auto-resolved runs from the latest user message (natural-language time scope). */
    resolvedRunScope,
    /** When set with `compareRunId`, deterministic summary is omitted (its reference run may differ). */
    focusedRunPair,
    /** Optional chronological series + setup deltas (same car) for trend questions. */
    patternDigest,
    /** Account-wide run inventory (compact rows); null when client disables to save tokens. */
    runCatalog,
    /** Learned k→k+1 tire-run pace medians (best, avg top 5/10/15) on this tire set. */
    tireLifePriors,
    thingsToTry: basePacket.thingsToTry,
    thingsToDo: basePacket.thingsToDo,
  };

  const baseForMerge = {
    defaultDashboardContext: basePacket,
    resolvedRunScope,
    patternDigest,
    runCatalog,
    tireLifePriors,
    thingsToTry: basePacket.thingsToTry,
    thingsToDo: basePacket.thingsToDo,
  };

  // #region agent log
  const __dbgContextJsonStr = JSON.stringify(contextJson);
  __dbgSend({
    runId: 'chat-stages',
    hypothesisId: 'H3',
    location: 'src/app/api/engineer/chat/route.ts:pre-llm',
    message: 'pre-LLM stage timings',
    data: {
      msgCount: messages.length,
      hasRunId: Boolean(runId),
      hasCompareRunId: Boolean(compareRunId),
      basePacketMs: __dbgT_basePacket,
      richContextMs: __dbgT_rich,
      runScopeMs: __dbgT_scope,
      summaryMs: __dbgT_summary,
      summaryPath: __dbgSummaryPath,
      summaryCached: __dbgSummaryCached,
      runCatalogMs: __dbgT_catalog,
      includeRunCatalog,
      contextJsonChars: __dbgContextJsonStr.length,
      basePacketChars: JSON.stringify(basePacket).length,
      richContextChars: richEngineerContext ? JSON.stringify(richEngineerContext).length : 0,
      summaryChars: engineerSummary ? JSON.stringify(engineerSummary).length : 0,
      runCatalogChars: runCatalog ? JSON.stringify(runCatalog).length : 0,
      preLlmTotalMs: Date.now() - __dbgT0,
    },
  });
  const __dbgT_llm0 = Date.now();
  // #endregion
  const out = await generateEngineerChatReplyWithTools({
    contextJson,
    messages,
    userId: user.id,
    mergeContextWithFocusedPair: async (focused) => {
      let summary: EngineerRunSummaryV2 | null = null;
      if (!focused.compareRunId) {
        const summaryResult = await getOrComputeEngineerSummaryForRun(user.id, focused.primaryRunId);
        summary = summaryResult?.summary ?? null;
      }
      const rich =
        lastUser && typeof lastUser.content === "string"
          ? await buildEngineerRichContextV1({
              userId: user.id,
              anchorRunId: focused.primaryRunId,
              lastUserMessage: lastUser.content,
            })
          : null;
      const reTire = await buildTireLifePriorsForChatContext({
        userId: user.id,
        anchorRunId: focused.primaryRunId,
        focusedPair: focusedPairForTirePriors(focused),
      });
      return {
        ...baseForMerge,
        engineerSummary: summary,
        focusedRunPair: focused,
        richEngineerContext: rich,
        tireLifePriors: reTire,
      };
    },
  });

  // #region agent log
  __dbgSend({
    runId: 'chat-stages',
    hypothesisId: 'H1',
    location: 'src/app/api/engineer/chat/route.ts:post-llm',
    message: 'LLM tool-loop returned',
    data: {
      llmMs: Date.now() - __dbgT_llm0,
      totalMs: Date.now() - __dbgT0,
      replyChars: out.reply.length,
      resolvedFocus: out.resolvedFocus ? {
        primary: out.resolvedFocus.runId,
        hasCompare: Boolean(out.resolvedFocus.compareRunId),
      } : null,
    },
  });
  // #endregion
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

