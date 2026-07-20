import {
  buildEngineerContextPacketV1,
  buildFocusedRunPairContext,
} from "@/lib/engineerPhase5/contextPacket";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import {
  engineerChatContextTier,
  engineerChatNeedsDeepContext,
} from "@/lib/engineerPhase5/engineerChatContextTier";
import type { EngineerChatMode } from "@/lib/engineerPhase5/engineerChatMode";
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
import { buildReasoningSpineV1 } from "@/lib/engineerPhase5/reasoningSpine/buildReasoningSpine";
import { applyHybridContextMode } from "@/lib/engineerPhase5/reasoningSpine/hybridContext";
import {
  parsePaceVsFieldRunDigestPayload,
  parsePaceVsFieldRunDigestSubsetPayload,
} from "@/lib/engineerPhase5/paceVsFieldRunDigestParse";
import { perfSpan } from "@/lib/perfLog";

export type EngineerChatPipelineBody = {
  includePatternDigest?: boolean;
  patternDigest?: unknown;
  includeRunCatalog?: boolean;
  paceVsFieldRunDigest?: unknown;
  paceVsFieldRunDigestSubset?: unknown;
};

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

export type BuiltEngineerChatContext =
  | { error: string }
  | {
      contextJson: Record<string, unknown>;
      baseForMerge: Record<string, unknown>;
      lastUser: EngineerChatMessage | undefined;
      needsDeep: boolean;
      contextTier: "light" | "full";
    };

export async function buildEngineerChatContext(params: {
  userId: string;
  body: EngineerChatPipelineBody | null;
  messages: EngineerChatMessage[];
  runId: string;
  compareRunId: string;
  mode?: EngineerChatMode;
  /** IANA zone for human time labels in the context (rc_tz / device zone). */
  timeZone?: string | null;
}): Promise<BuiltEngineerChatContext> {
  return perfSpan("buildEngineerChatContext", async () => {
    const { userId, body, messages, runId, compareRunId, mode, timeZone } = params;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const needsDeep = engineerChatNeedsDeepContext({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
      mode,
    });
    const contextTier = engineerChatContextTier({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
      mode,
    });

    const [basePacket, focusedRunPair] = await Promise.all([
      perfSpan("buildEngineerContextPacketV1", () => buildEngineerContextPacketV1(userId, timeZone)),
      runId
        ? perfSpan("buildFocusedRunPairContext", () =>
            buildFocusedRunPairContext(userId, runId, compareRunId || null, timeZone)
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

    const [summaryResult, tireLifePriors, setupOutcomeMemory, engineeringBrain, runCatalog] =
      await Promise.all([
        needsDeep
          ? !focusedRunPair
            ? perfSpan("getOrComputeEngineerSummaryForLatestRun", () =>
                getOrComputeEngineerSummaryForLatestRun(userId, { timeZone })
              )
            : !compareRunId
              ? perfSpan("getOrComputeEngineerSummaryForRun", () =>
                  getOrComputeEngineerSummaryForRun(userId, focusedRunPair.primaryRunId, { timeZone })
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
                timeZone,
              }).catch(() => null)
            )
          : Promise.resolve(null),
        includeRunCatalog ? buildRunCatalogV1({ userId }) : Promise.resolve(null),
      ]);

    const engineerSummary: EngineerRunSummaryV2 | null = summaryResult?.summary ?? null;
    const setupHandlingPaceBundle = needsDeep ? buildSetupHandlingPaceBundle(focusedRunPair) : null;

    const reasoningSpine =
      lastUser && typeof lastUser.content === "string"
        ? buildReasoningSpineV1({
            userMessage: lastUser.content,
            engineeringRead: engineeringBrain?.engineeringRead ?? null,
            parameterIntentMatches: richEngineerContext?.parameterIntentMatches ?? null,
            setupOutcomeMemory,
          })
        : null;

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
      reasoningSpine,
      resolvedScopeTireSteps: null,
      thingsToTry: basePacket.thingsToTry,
      thingsToDo: basePacket.thingsToDo,
      paceVsFieldRunDigest,
      paceVsFieldRunDigestSubset,
    };

    if (reasoningSpine) applyHybridContextMode(contextJson, reasoningSpine);

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
      reasoningSpine,
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

export function buildMergeContextWithFocusedPair(opts: {
  userId: string;
  baseForMerge: Record<string, unknown>;
  lastUser: EngineerChatMessage | undefined;
  timeZone?: string | null;
}) {
  return async (focused: NonNullable<Awaited<ReturnType<typeof buildFocusedRunPairContext>>>) => {
    const [summaryResult, rich, reTire, reSetupOutcomeMemory, reEngineeringBrain] = await Promise.all([
      !focused.compareRunId
        ? getOrComputeEngineerSummaryForRun(opts.userId, focused.primaryRunId, {
            timeZone: opts.timeZone,
          })
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
            timeZone: opts.timeZone,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const reasoningSpine =
      opts.lastUser && typeof opts.lastUser.content === "string"
        ? buildReasoningSpineV1({
            userMessage: opts.lastUser.content,
            engineeringRead: reEngineeringBrain?.engineeringRead ?? null,
            parameterIntentMatches: rich?.parameterIntentMatches ?? null,
            setupOutcomeMemory: reSetupOutcomeMemory,
          })
        : null;
    const merged = {
      ...opts.baseForMerge,
      contextTier: "full",
      engineerSummary: summaryResult?.summary ?? null,
      focusedRunPair: focused,
      richEngineerContext: rich,
      tireLifePriors: reTire,
      setupHandlingPaceBundle: buildSetupHandlingPaceBundle(focused),
      setupOutcomeMemory: reSetupOutcomeMemory,
      engineeringBrain: reEngineeringBrain,
      reasoningSpine,
    };
    if (reasoningSpine) applyHybridContextMode(merged, reasoningSpine);
    return merged;
  };
}

export async function runEngineerChatTurn(params: {
  userId: string;
  question: string;
  runId?: string;
  compareRunId?: string;
  mode?: EngineerChatMode;
  timeZone?: string | null;
}): Promise<{
  reply: string;
  contextJson: unknown;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  usage: import("@/lib/engineerPhase5/openaiEngineer").EngineerChatUsage | null;
}> {
  const runId = params.runId?.trim() ?? "";
  const compareRunId = params.compareRunId?.trim() ?? "";
  const messages: EngineerChatMessage[] = [{ role: "user", content: params.question.trim() }];

  const built = await buildEngineerChatContext({
    userId: params.userId,
    body: null,
    messages,
    runId,
    compareRunId,
    mode: params.mode,
    timeZone: params.timeZone,
  });
  if ("error" in built) {
    throw new Error(built.error);
  }

  const mergeContextWithFocusedPair = buildMergeContextWithFocusedPair({
    userId: params.userId,
    baseForMerge: built.baseForMerge,
    lastUser: built.lastUser,
    timeZone: params.timeZone,
  });

  const out = await generateEngineerChatReplyWithTools({
    contextJson: built.contextJson,
    messages,
    userId: params.userId,
    mergeContextWithFocusedPair,
    contextTier: built.contextTier,
    mode: params.mode,
    timeZone: params.timeZone,
  });

  return {
    reply: out.reply,
    contextJson: out.contextJson,
    resolvedFocus: out.resolvedFocus,
    usage: out.usage,
  };
}
