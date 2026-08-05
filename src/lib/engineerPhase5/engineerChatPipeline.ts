import {
  buildEngineerContextPacketV1,
  buildFocusedRunPairContext,
} from "@/lib/engineerPhase5/contextPacket";
import { buildEngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";
import {
  engineerChatContextTier,
  engineerChatNeedsDeepContext,
  type EngineerChatContextTier,
} from "@/lib/engineerPhase5/engineerChatContextTier";
import {
  assembleGeneralChatContext,
  generalAnchorLabel,
} from "@/lib/engineerPhase5/engineerGeneralContext";
import { loadGeneralCarIdentity } from "@/lib/engineerPhase5/generalCarIdentity";
import { getOrComputeEngineerSummaryForLatestRun } from "@/lib/engineerPhase5/loadLatestEngineerSummary";
import { getOrComputeEngineerSummaryForRun } from "@/lib/engineerPhase5/loadEngineerSummaryForRun";
import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import {
  generateEngineerChatReplyWithTools,
  type EngineerChatMessage,
  type EngineerPinnedAnchorForModel,
} from "@/lib/engineerPhase5/openaiEngineer";
import { buildRunCatalogV1 } from "@/lib/engineerPhase5/runCatalog";
import { buildTireLifePriorsForChatContext } from "@/lib/engineerPhase5/tireLifePriors/computeTireLifePriors";
import { buildSetupHandlingPaceBundle } from "@/lib/engineerPhase5/setupHandlingPaceBundle";
import { buildSetupOutcomeMemoryForRun } from "@/lib/engineerPhase5/setupOutcomeMemory";
import { buildEngineeringBrainV1 } from "@/lib/engineerPhase5/engineeringBrain";
import { findComparableRunsForEngineer } from "@/lib/engineerPhase5/findComparableRuns";
import { buildReasoningSpineV1 } from "@/lib/engineerPhase5/reasoningSpine/buildReasoningSpine";
import {
  parsePaceVsFieldRunDigestPayload,
  parsePaceVsFieldRunDigestSubsetPayload,
} from "@/lib/engineerPhase5/paceVsFieldRunDigestParse";
import {
  anchorToRunFocus,
  resolveAnchorRunForRichContext,
  type EngineerChatAnchor,
} from "@/lib/engineerPhase5/engineerAnchor";
import {
  buildSavedSetupAnchorContext,
  resolveSetupAnchorDerivedRunId,
} from "@/lib/engineerPhase5/savedSetupAnchorContext";
import {
  buildEventAnchorDigest,
  resolveEventAnchorDerivedRunId,
} from "@/lib/engineerPhase5/eventAnchorDigest";
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
      contextTier: EngineerChatContextTier;
      /** Human label for the effective anchor (chip / persistence); null when unresolvable. */
      anchorLabel: string | null;
    };

export async function buildEngineerChatContext(params: {
  userId: string;
  body: EngineerChatPipelineBody | null;
  messages: EngineerChatMessage[];
  runId: string;
  compareRunId: string;
  /** Explicit anchor from the chat request; wins over runId/compareRunId when present. */
  anchor?: EngineerChatAnchor | null;
  /** IANA zone for human time labels in the context (rc_tz / device zone). */
  timeZone?: string | null;
  /**
   * Coarse progress ticks for the chat's SSE status line — optional, so non-streaming
   * callers are unaffected. Each tick fires immediately before work that is genuinely
   * about to be awaited; labels live in `engineerChatStatus.ts`.
   */
  onStage?: (phase: string) => void;
}): Promise<BuiltEngineerChatContext> {
  return perfSpan("buildEngineerChatContext", async () => {
    const { userId, body, messages, timeZone, onStage } = params;
    const anchor = params.anchor ?? null;
    const { runId, compareRunId } = anchorToRunFocus(anchor, {
      runId: params.runId,
      compareRunId: params.compareRunId,
    });
    const lastUser = [...messages].reverse().find((m) => m.role === "user");

    // General question (founder interview 2026-07-30): theory-only hard subject. Built
    // from KB + optional car identity ONLY — none of the packet/summary/priors/memory/
    // brain builders below may run, so no latest-run context can leak in.
    if (anchor?.kind === "general") {
      onStage?.("context_kb");
      const carIdentity = anchor.carId
        ? await loadGeneralCarIdentity(userId, anchor.carId)
        : null;
      const richEngineerContext =
        lastUser && typeof lastUser.content === "string"
          ? await perfSpan("buildEngineerRichContextV1", () =>
              buildEngineerRichContextV1({
                userId,
                anchorRunId: null,
                lastUserMessage: lastUser.content,
                opts: { spreadDepth: "none", kbLimit: 10, skipFieldStats: true, mode: "general" },
              })
            )
          : null;
      const contextJson = assembleGeneralChatContext({ carIdentity, richEngineerContext });
      return {
        contextJson,
        baseForMerge: contextJson,
        lastUser,
        needsDeep: false,
        contextTier: "general",
        anchorLabel: generalAnchorLabel(carIdentity),
      };
    }

    const needsDeep = engineerChatNeedsDeepContext({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
      anchorPinned: anchor?.pinned,
      anchorKind: anchor?.kind ?? null,
    });
    const contextTier = engineerChatContextTier({
      lastUserMessage: lastUser?.content,
      runId,
      compareRunId,
      anchorPinned: anchor?.pinned,
      anchorKind: anchor?.kind ?? null,
    });

    onStage?.("context_runs");

    // A setup reaches the Engineer either as the anchor itself (kind=setup) or riding
    // along on a run pin ("would this sheet have helped here?" — anchor.setupId).
    const setupAnchorId = anchor ? (anchor.kind === "setup" ? anchor.id : anchor.setupId) : null;

    const [basePacket, focusedRunPair, anchoredSavedSetup, anchoredEventDigest] = await Promise.all([
      perfSpan("buildEngineerContextPacketV1", () => buildEngineerContextPacketV1(userId, timeZone)),
      runId
        ? perfSpan("buildFocusedRunPairContext", () =>
            buildFocusedRunPairContext(userId, runId, compareRunId || null, timeZone)
          )
        : Promise.resolve(null),
      setupAnchorId
        ? perfSpan("buildSavedSetupAnchorContext", () =>
            buildSavedSetupAnchorContext({
              userId,
              setupId: setupAnchorId,
              anchoredRunId: runId || null,
              timeZone,
            })
          )
        : Promise.resolve(null),
      anchor?.kind === "event"
        ? perfSpan("buildEventAnchorDigest", () =>
            buildEventAnchorDigest({ userId, eventId: anchor.id, timeZone })
          )
        : Promise.resolve(null),
    ]);

    if (runId && !focusedRunPair) {
      return { error: "Run not found" };
    }
    if (anchor?.kind === "setup" && !anchoredSavedSetup) {
      return { error: "Setup not found" };
    }
    if (anchor?.kind === "event" && !anchoredEventDigest) {
      return { error: "Event not found" };
    }

    // A setup-only pin anchors rich context to its most related run (latest run based on
    // it, else latest on its car); an event pin anchors to the latest own run at the meeting.
    const anchorDerivedRunId =
      anchor?.kind === "setup" && anchoredSavedSetup
        ? await resolveSetupAnchorDerivedRunId({
            userId,
            setupId: anchoredSavedSetup.setupId,
            carId: anchoredSavedSetup.carId,
          })
        : anchor?.kind === "event"
          ? await resolveEventAnchorDerivedRunId({ userId, eventId: anchor.id })
          : null;

    const anchorForRichContext = resolveAnchorRunForRichContext({
      anchor,
      focusedRunId: runId,
      anchorDerivedRunId,
      latestRunId: basePacket.latestRun?.id ?? null,
    });

    const anchorLabel =
      anchor?.kind === "event" && anchoredEventDigest
        ? [anchoredEventDigest.name, anchoredEventDigest.trackName].filter(Boolean).join(" · ")
        : anchor?.kind === "setup" && anchoredSavedSetup
        ? [anchoredSavedSetup.name ?? "Saved setup", anchoredSavedSetup.carName]
            .filter(Boolean)
            .join(" · ")
        : focusedRunPair
          ? [
              focusedRunPair.primary.whenLabel,
              focusedRunPair.primary.sessionTypeLabel,
              focusedRunPair.primary.carName,
            ]
              .filter(Boolean)
              .join(" · ") || null
          : null;

    /**
     * Names the user-pinned subject inside the context itself; survives
     * apply_engineer_focus merges via baseForMerge.
     */
    const pinnedFocus = anchor?.pinned
      ? {
          kind: anchor.kind,
          id: anchor.id,
          compareRunId: anchor.compareRunId,
          setupId: anchor.setupId,
          label: anchorLabel,
          pinned: true as const,
        }
      : null;

    if (lastUser && typeof lastUser.content === "string") onStage?.("context_kb");

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

    // Only when it's real work — without `needsDeep` every branch below resolves to null
    // instantly and the status line would be claiming work that never happens.
    if (needsDeep) onStage?.("context_history");

    const [
      summaryResult,
      tireLifePriors,
      setupOutcomeMemory,
      engineeringBrain,
      runCatalog,
      comparableRuns,
    ] = await Promise.all([
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
        // Replaces the deleted diagnosisConfidence grade: the nearest runs by CONDITIONS
        // (tyre, grip, layout), not the last run by date. What the founder actually asks
        // first — "was this car ever good in these conditions, and what changed since".
        needsDeep && anchorForRichContext
          ? perfSpan("findComparableRunsForEngineer", () =>
              findComparableRunsForEngineer(userId, anchorForRichContext).catch(() => [])
            )
          : Promise.resolve([]),
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
            comparableRuns,
          })
        : null;

    const contextJson: Record<string, unknown> = {
      contextTier,
      pinnedFocus,
      anchoredSavedSetup,
      anchoredEventDigest,
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

    /**
     * Hybrid context mode DELETED 2026-08-04. On every setup, planning and comparison
     * question it emptied `setupVsSpread.rows` — the driver's own values against the
     * community spread — and told the model to fetch them with a tool if it wanted them.
     * It often didn't, and then recommended moving a setting whose current value it had
     * never seen. It also trimmed the KB excerpts, which by then had already been replaced
     * by a pointer to the full corpus in system message 0, so that half was a no-op.
     *
     * Size is handled properly by `slimEngineerChatContextForApi`, which caps the rows and
     * drops them with a note only when the payload genuinely will not fit — degrading under
     * pressure rather than deleting up front.
     */

    const baseForMerge: Record<string, unknown> = {
      contextTier,
      pinnedFocus,
      anchoredSavedSetup,
      anchoredEventDigest,
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
      anchorLabel,
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
    const [
      summaryResult,
      rich,
      reTire,
      reSetupOutcomeMemory,
      reEngineeringBrain,
      reComparableRuns,
    ] = await Promise.all([
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
      findComparableRunsForEngineer(opts.userId, focused.primaryRunId).catch(() => []),
    ]);
    const reasoningSpine =
      opts.lastUser && typeof opts.lastUser.content === "string"
        ? buildReasoningSpineV1({
            userMessage: opts.lastUser.content,
            engineeringRead: reEngineeringBrain?.engineeringRead ?? null,
            parameterIntentMatches: rich?.parameterIntentMatches ?? null,
            setupOutcomeMemory: reSetupOutcomeMemory,
            comparableRuns: reComparableRuns,
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
    return merged;
  };
}

/**
 * Collapse an anchor into the shape the model prompt consumes. Lives here rather than in the
 * chat route because the route is no longer the only caller — the bench pins anchors too, and a
 * second copy of this would drift the way the three model-pricing tables did.
 *
 * Only a PINNED anchor reaches the model: an Auto anchor is a visible guess the model is allowed
 * to refocus away from, so handing it down as a hard subject would misrepresent it.
 */
export function pinnedAnchorForModel(
  anchor: EngineerChatAnchor | null,
  anchorLabel: string | null
): EngineerPinnedAnchorForModel | null {
  if (!anchor?.pinned) return null;
  return {
    kind: anchor.kind,
    label: anchorLabel,
    primaryRunId: anchor.kind === "run" ? anchor.id : null,
    compareRunId: anchor.kind === "run" ? anchor.compareRunId : null,
  };
}

export async function runEngineerChatTurn(params: {
  userId: string;
  question: string;
  runId?: string;
  compareRunId?: string;
  timeZone?: string | null;
  /**
   * Pinned subject, exactly as the chat route builds it. Without this the run is only a SOFT
   * focus: `basePacket.latestRun` stays in context and the model may answer about that instead —
   * observed in the bench answering about a TFTR run while anchored to a Boronia one. Callers
   * that want `runId` to mean "this run and no other" must pass a pinned anchor.
   */
  anchor?: EngineerChatAnchor | null;
}): Promise<{
  reply: string;
  contextJson: unknown;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  usage: import("@/lib/engineerPhase5/openaiEngineer").EngineerChatUsage | null;
}> {
  const runId = params.runId?.trim() ?? "";
  const compareRunId = params.compareRunId?.trim() ?? "";
  const messages: EngineerChatMessage[] = [{ role: "user", content: params.question.trim() }];

  const anchor = params.anchor ?? null;
  const built = await buildEngineerChatContext({
    userId: params.userId,
    body: null,
    messages,
    runId,
    compareRunId,
    timeZone: params.timeZone,
    anchor,
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
    timeZone: params.timeZone,
    pinnedAnchor: pinnedAnchorForModel(anchor, built.anchorLabel ?? null),
  });

  return {
    reply: out.reply,
    contextJson: out.contextJson,
    resolvedFocus: out.resolvedFocus,
    usage: out.usage,
  };
}
