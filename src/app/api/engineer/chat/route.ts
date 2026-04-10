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
import { generateEngineerChatReply, type EngineerChatMessage } from "@/lib/engineerPhase5/openaiEngineer";

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

  const basePacket = await buildEngineerContextPacketV1(user.id);

  let focusedRunPair = null as Awaited<ReturnType<typeof buildFocusedRunPairContext>>;
  if (runId) {
    focusedRunPair = await buildFocusedRunPairContext(user.id, runId, compareRunId || null);
    if (!focusedRunPair) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
  }

  let engineerSummary: EngineerRunSummaryV2 | null = null;
  if (!focusedRunPair) {
    const summaryResult = await getOrComputeEngineerSummaryForLatestRun(user.id);
    engineerSummary = summaryResult?.summary ?? null;
  } else if (!compareRunId) {
    const summaryResult = await getOrComputeEngineerSummaryForRun(user.id, focusedRunPair.primaryRunId);
    engineerSummary = summaryResult?.summary ?? null;
  }

  const contextJson = {
    defaultDashboardContext: basePacket,
    engineerSummary,
    /** When set with `compareRunId`, deterministic summary is omitted (its reference run may differ). */
    focusedRunPair,
    thingsToTry: basePacket.thingsToTry,
  };
  const out = await generateEngineerChatReply({ contextJson, messages });
  return NextResponse.json({ contextJson, reply: out.reply });
}

