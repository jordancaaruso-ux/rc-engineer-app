/** Rough chars-per-token for JSON + English (conservative). */
const CHARS_PER_TOKEN_EST = 3.8;

/** Target context JSON size — leaves room for system prompt, tools, and reply under ~30k TPM. */
export const ENGINEER_CHAT_CONTEXT_MAX_CHARS =
  Number(process.env.ENGINEER_CHAT_CONTEXT_MAX_CHARS) > 0
    ? Number(process.env.ENGINEER_CHAT_CONTEXT_MAX_CHARS)
    : 32_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncateStr(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function compactSpreadRow(row: unknown): unknown {
  if (!isRecord(row)) return row;
  const spread = isRecord(row.spread) ? row.spread : null;
  const gts = isRecord(row.gripTrendSignal) ? row.gripTrendSignal : null;
  const gsc = isRecord(row.gripSpreadContrast) ? row.gripSpreadContrast : null;
  return {
    parameterKey: row.parameterKey,
    label: row.label,
    currentDisplay: row.currentDisplay,
    spreadSource: row.spreadSource,
    positionBand: row.positionBand,
    communityGripLevel: row.communityGripLevel,
    spread: spread
      ? {
          median: spread.median,
          mean: spread.mean,
          iqr: spread.iqr,
          sampleCount: spread.sampleCount,
        }
      : null,
    gripTrendSignal: gts
      ? {
          magnitude: gts.magnitude,
          direction: gts.direction,
          delta: gts.delta,
          meetsMinMeaningfulDelta: gts.meetsMinMeaningfulDelta,
        }
      : null,
    gripSpreadContrast: gsc
      ? { magnitude: gsc.magnitude, widerIn: gsc.widerIn, skewNote: gsc.skewNote }
      : null,
  };
}

function slimRichContext(rich: unknown): unknown {
  if (!isRecord(rich)) return rich;
  const setup = isRecord(rich.setupVsSpread) ? { ...rich.setupVsSpread } : null;
  if (setup && Array.isArray(setup.rows)) {
    setup.rows = setup.rows.map(compactSpreadRow);
    setup.note = truncateStr(setup.note, 600) ?? setup.note;
  }
  const kb = Array.isArray(rich.vehicleDynamicsKb)
    ? rich.vehicleDynamicsKb.slice(0, 6).map((k) => {
        if (!isRecord(k)) return k;
        return {
          title: k.title,
          sourcePath: k.sourcePath,
          excerpt: truncateStr(k.excerpt, 420),
        };
      })
    : rich.vehicleDynamicsKb;
  return {
    ...rich,
    setupVsSpread: setup,
    vehicleDynamicsKb: kb,
    conditionalSetupEmpirical: null,
    bulkheadInnerSplits: rich.bulkheadInnerSplits
      ? {
          signNote: isRecord(rich.bulkheadInnerSplits) ? rich.bulkheadInnerSplits.signNote : null,
          frontUpperInnerMm: isRecord(rich.bulkheadInnerSplits)
            ? rich.bulkheadInnerSplits.frontUpperInnerMm
            : null,
          rearUpperInnerMm: isRecord(rich.bulkheadInnerSplits)
            ? rich.bulkheadInnerSplits.rearUpperInnerMm
            : null,
          upperInnerFrontAvgMinusRearAvgMm: isRecord(rich.bulkheadInnerSplits)
            ? rich.bulkheadInnerSplits.upperInnerFrontAvgMinusRearAvgMm
            : null,
        }
      : null,
  };
}

function slimEngineeringBrain(brain: unknown): unknown {
  if (!isRecord(brain)) return brain;
  return {
    version: brain.version,
    promptLines: Array.isArray(brain.promptLines) ? brain.promptLines.slice(0, 24) : [],
    recommendationStrategy: isRecord(brain.engineeringRead)
      ? (brain.engineeringRead as Record<string, unknown>).recommendationStrategy
      : null,
  };
}

function slimFocusedPair(pair: unknown): unknown {
  if (!isRecord(pair)) return pair;
  const setup = isRecord(pair.setupComparison) ? { ...pair.setupComparison } : null;
  if (setup && Array.isArray(setup.changedRows) && setup.changedRows.length > 28) {
    setup.changedRows = setup.changedRows.slice(0, 28);
    setup.truncated = true;
  }
  const kbSnippets = Array.isArray(pair.setupCompareKbSnippets)
    ? pair.setupCompareKbSnippets.slice(0, 6).map((k) => {
        if (!isRecord(k)) return k;
        return {
          title: k.title,
          sourcePath: k.sourcePath,
          excerpt: truncateStr(k.excerpt, 380),
        };
      })
    : pair.setupCompareKbSnippets;
  return {
    ...pair,
    handlingAssessmentJsonByRun: undefined,
    setupCompareKbSnippets: kbSnippets,
    setupComparison: setup,
    notesPreview: truncateStr(pair.notesPreview, 280),
    handlingPreview: truncateStr(pair.handlingPreview, 500),
    primary: isRecord(pair.primary)
      ? { ...pair.primary, notesPreview: truncateStr(pair.primary.notesPreview, 280) }
      : pair.primary,
    compare: isRecord(pair.compare)
      ? { ...pair.compare, notesPreview: truncateStr(pair.compare.notesPreview, 280) }
      : pair.compare,
  };
}

function slimDashboardContext(pkt: unknown): unknown {
  if (!isRecord(pkt)) return pkt;
  return {
    version: pkt.version,
    latestRun: pkt.latestRun,
    previousRun: pkt.previousRun,
    comparison: pkt.comparison,
    thingsToTry: Array.isArray(pkt.thingsToTry) ? pkt.thingsToTry.slice(0, 8) : [],
    thingsToDo: Array.isArray(pkt.thingsToDo) ? pkt.thingsToDo.slice(0, 8) : [],
  };
}

function slimDigest(digest: unknown, maxRows: number): unknown {
  if (!isRecord(digest) || !Array.isArray(digest.rows)) return digest;
  return {
    ...digest,
    rows: digest.rows.slice(0, maxRows),
    omittedAfterCap:
      (typeof digest.omittedAfterCap === "number" ? digest.omittedAfterCap : 0) +
      Math.max(0, digest.rows.length - maxRows),
  };
}

function slimSetupOutcomeMemory(mem: unknown): unknown {
  if (!isRecord(mem) || !Array.isArray(mem.rows)) return mem;
  return { ...mem, rows: mem.rows.slice(0, 12) };
}

function slimTireLifePriors(priors: unknown): unknown {
  if (!isRecord(priors)) return priors;
  const out: Record<string, unknown> = { ...priors };
  for (const key of ["atAnchorTrack", "allYourTracksOnSet", "focusedCompareNudge"]) {
    if (isRecord(out[key]) && Array.isArray((out[key] as Record<string, unknown>).steps)) {
      const block = { ...(out[key] as Record<string, unknown>) };
      block.steps = (block.steps as unknown[]).slice(0, 8);
      out[key] = block;
    }
  }
  return out;
}

type SlimPass = (ctx: Record<string, unknown>) => void;

const SLIM_PASSES: SlimPass[] = [
  (ctx) => {
    if (ctx.richEngineerContext) ctx.richEngineerContext = slimRichContext(ctx.richEngineerContext);
    if (ctx.engineeringBrain) ctx.engineeringBrain = slimEngineeringBrain(ctx.engineeringBrain);
    if (ctx.focusedRunPair) ctx.focusedRunPair = slimFocusedPair(ctx.focusedRunPair);
    if (ctx.defaultDashboardContext) {
      ctx.defaultDashboardContext = slimDashboardContext(ctx.defaultDashboardContext);
    }
    if (ctx.setupOutcomeMemory) ctx.setupOutcomeMemory = slimSetupOutcomeMemory(ctx.setupOutcomeMemory);
    if (ctx.tireLifePriors) ctx.tireLifePriors = slimTireLifePriors(ctx.tireLifePriors);
    if (ctx.paceVsFieldRunDigest) ctx.paceVsFieldRunDigest = slimDigest(ctx.paceVsFieldRunDigest, 16);
    if (ctx.paceVsFieldRunDigestSubset) {
      ctx.paceVsFieldRunDigestSubset = slimDigest(ctx.paceVsFieldRunDigestSubset, 16);
    }
  },
  (ctx) => {
    ctx.runCatalog = null;
    ctx.patternDigest = null;
    ctx.resolvedScopeTireSteps = null;
    if (isRecord(ctx.richEngineerContext) && isRecord(ctx.richEngineerContext.setupVsSpread)) {
      const rows = ctx.richEngineerContext.setupVsSpread.rows;
      if (Array.isArray(rows) && rows.length > 22) {
        ctx.richEngineerContext = {
          ...ctx.richEngineerContext,
          setupVsSpread: {
            ...ctx.richEngineerContext.setupVsSpread,
            rows: rows.slice(0, 22),
            truncated: true,
          },
        };
      }
    }
  },
  (ctx) => {
    ctx.engineerSummary = null;
    ctx.setupHandlingPaceBundle = null;
    if (isRecord(ctx.richEngineerContext) && isRecord(ctx.richEngineerContext.setupVsSpread)) {
      ctx.richEngineerContext = {
        ...ctx.richEngineerContext,
        setupVsSpread: {
          note: "Spread rows omitted — use apply_engineer_focus or ask a setup-specific question for full bands.",
          siblingCarCount: ctx.richEngineerContext.setupVsSpread.siblingCarCount,
          communitySpreadAvailable: ctx.richEngineerContext.setupVsSpread.communitySpreadAvailable,
          communityContext: ctx.richEngineerContext.setupVsSpread.communityContext,
          rows: [],
          truncated: true,
        },
        importedSessionFieldStats: isRecord(ctx.richEngineerContext.importedSessionFieldStats)
          ? {
              driverCount: ctx.richEngineerContext.importedSessionFieldStats.driverCount,
              matchedYou: ctx.richEngineerContext.importedSessionFieldStats.matchedYou,
              paceVsFieldMeanAnalysis:
                ctx.richEngineerContext.importedSessionFieldStats.paceVsFieldMeanAnalysis,
            }
          : null,
      };
    }
  },
];

/**
 * Shrinks engineer chat context JSON to fit org TPM limits. Mutates a clone; safe for API payloads only.
 */
export function slimEngineerChatContextForApi(
  raw: unknown,
  opts?: { maxJsonChars?: number }
): { context: Record<string, unknown>; trimmed: boolean; jsonChars: number } {
  const maxJsonChars = opts?.maxJsonChars ?? ENGINEER_CHAT_CONTEXT_MAX_CHARS;
  if (!isRecord(raw)) {
    const json = JSON.stringify(raw ?? {});
    return { context: { value: raw }, trimmed: false, jsonChars: json.length };
  }

  let ctx = structuredClone(raw) as Record<string, unknown>;
  let json = JSON.stringify(ctx);
  if (json.length <= maxJsonChars) {
    return { context: ctx, trimmed: false, jsonChars: json.length };
  }

  ctx._contextTrimmed = true;
  ctx._contextTrimNote =
    "Large fields were compacted for the token budget; use search_runs / apply_engineer_focus for full run detail.";

  for (const pass of SLIM_PASSES) {
    pass(ctx);
    json = JSON.stringify(ctx);
    if (json.length <= maxJsonChars) {
      return { context: ctx, trimmed: true, jsonChars: json.length };
    }
  }

  return { context: ctx, trimmed: true, jsonChars: json.length };
}

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_EST);
}

export function formatEngineerChatContextSystemMessage(
  raw: unknown,
  label = "Context (JSON):",
  maxJsonChars?: number
): string {
  const { context } = slimEngineerChatContextForApi(
    raw,
    maxJsonChars != null ? { maxJsonChars } : undefined
  );
  return `${label}\n${JSON.stringify(context)}`;
}

function openAiErrorMessage(data: Record<string, unknown> | undefined): string {
  return (data?.error as { message?: string } | undefined)?.message ?? "";
}

export function isContextTooLargeOpenAiError(data: Record<string, unknown> | undefined): boolean {
  const msg = openAiErrorMessage(data);
  return /Request too large|maximum context length/i.test(msg);
}

export function isOpenAiTpmRateLimitError(data: Record<string, unknown> | undefined): boolean {
  const msg = openAiErrorMessage(data);
  return /tokens per min|rate_limit_exceeded/i.test(msg);
}

/** Parse "Please try again in 388ms" from OpenAI error bodies. */
export function parseOpenAiRetryAfterMs(data: Record<string, unknown> | undefined): number {
  const msg = openAiErrorMessage(data);
  const m = msg.match(/try again in (\d+)\s*ms/i);
  if (m) return Math.min(15_000, Math.max(200, Number(m[1])));
  return 1000;
}
