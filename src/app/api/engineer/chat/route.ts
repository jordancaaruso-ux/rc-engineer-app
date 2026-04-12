import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  buildEngineerContextPacketV1,
  buildFocusedRunPairContext,
} from "@/lib/engineerPhase5/contextPacket";
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

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  if (!hasOpenAiApiKey()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
  }
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
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
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
      return {
        ...baseForMerge,
        engineerSummary: summary,
        focusedRunPair: focused,
      };
    },
  });

  return NextResponse.json({
    contextJson: out.contextJson,
    reply: out.reply,
    resolvedFocus: out.resolvedFocus,
  });
}

