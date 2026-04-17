import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
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

export const dynamic = "force-dynamic";

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
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as
    | {
        messages?: Array<{ role?: unknown; content?: unknown }>;
        runId?: unknown;
        compareRunId?: unknown;
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

  const basePacket = await buildEngineerContextPacketV1(user.id);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const anchorForRichContext = runId || basePacket.latestRun?.id || null;
  const richEngineerContext =
    lastUser && typeof lastUser.content === "string"
      ? await buildEngineerRichContextV1({
          userId: user.id,
          anchorRunId: anchorForRichContext,
          lastUserMessage: lastUser.content,
        })
      : null;
  const resolvedRunScope =
    !runId && lastUser
      ? await resolveRunScopeForEngineerChat({
          userId: user.id,
          lastUserMessage: lastUser.content,
          timeZone,
        }).catch(() => null)
      : null;

  let focusedRunPair = null as Awaited<ReturnType<typeof buildFocusedRunPairContext>>;
  if (runId) {
    focusedRunPair = await buildFocusedRunPairContext(user.id, runId, compareRunId || null);
    if (!focusedRunPair) {
      return jsonError(404, "Run not found");
    }
  }

  let engineerSummary: EngineerRunSummaryV2 | null = null;
  /** Omit latest-vs-reference summary whenever auto scope is active (including zero matching runs). */
  const omitPairwiseSummary = Boolean(resolvedRunScope?.preferOverDefaultPair);
  if (!focusedRunPair && !omitPairwiseSummary) {
    const summaryResult = await getOrComputeEngineerSummaryForLatestRun(user.id);
    engineerSummary = summaryResult?.summary ?? null;
  } else if (!focusedRunPair && omitPairwiseSummary) {
    engineerSummary = null;
  } else if (focusedRunPair && !compareRunId) {
    const summaryResult = await getOrComputeEngineerSummaryForRun(user.id, focusedRunPair.primaryRunId);
    engineerSummary = summaryResult?.summary ?? null;
  }

  const patternDigest =
    body?.patternDigest && typeof body.patternDigest === "object" && body.patternDigest !== null
      ? body.patternDigest
      : null;

  const includeRunCatalog = body?.includeRunCatalog !== false;
  const runCatalog = includeRunCatalog ? await buildRunCatalogV1({ userId: user.id }) : null;

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
    thingsToTry: basePacket.thingsToTry,
  };

  const baseForMerge = {
    defaultDashboardContext: basePacket,
    resolvedRunScope,
    patternDigest,
    runCatalog,
    thingsToTry: basePacket.thingsToTry,
  };

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
      return {
        ...baseForMerge,
        engineerSummary: summary,
        focusedRunPair: focused,
        richEngineerContext: rich,
      };
    },
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

