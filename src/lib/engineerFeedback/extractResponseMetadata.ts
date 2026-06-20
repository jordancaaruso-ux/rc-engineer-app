import type { EngineerMessageContextSnapshot } from "@/lib/engineerFeedback/types";

function kbSectionsFromContext(contextJson: unknown): string[] {
  if (!contextJson || typeof contextJson !== "object") return [];
  const rich = (contextJson as Record<string, unknown>).richEngineerContext;
  if (!rich || typeof rich !== "object") return [];
  const kb = (rich as Record<string, unknown>).vehicleDynamicsKb;
  if (!Array.isArray(kb)) return [];
  const out: string[] = [];
  for (const item of kb) {
    if (!item || typeof item !== "object") continue;
    const title = (item as { title?: string }).title?.trim();
    const sourcePath = (item as { sourcePath?: string }).sourcePath?.trim();
    if (!title) continue;
    out.push(sourcePath ? `${title} (${sourcePath})` : title);
  }
  return out;
}

function runIdsFromContext(
  contextJson: unknown,
  resolvedFocus: { runId: string; compareRunId: string | null } | null,
  runId: string,
  compareRunId: string
): { runId: string | null; compareRunId: string | null } {
  if (resolvedFocus?.runId) {
    return { runId: resolvedFocus.runId, compareRunId: resolvedFocus.compareRunId };
  }
  if (contextJson && typeof contextJson === "object") {
    const focused = (contextJson as Record<string, unknown>).focusedRunPair;
    if (focused && typeof focused === "object") {
      const primaryRunId = (focused as { primaryRunId?: string }).primaryRunId?.trim();
      const compare = (focused as { compareRunId?: string | null }).compareRunId ?? null;
      if (primaryRunId) {
        return { runId: primaryRunId, compareRunId: compare };
      }
    }
  }
  return {
    runId: runId.trim() || null,
    compareRunId: compareRunId.trim() || null,
  };
}

export function buildEngineerResponseMetadata(opts: {
  question: string;
  answer: string;
  contextJson: unknown | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  runId?: string;
  compareRunId?: string;
  source?: string;
}): EngineerMessageContextSnapshot {
  const ids = runIdsFromContext(
    opts.contextJson,
    opts.resolvedFocus,
    opts.runId ?? "",
    opts.compareRunId ?? ""
  );
  return {
    question: opts.question.slice(0, 4096),
    answer: opts.answer.slice(0, 8192),
    runId: ids.runId,
    compareRunId: ids.compareRunId,
    setupIds: [],
    kbSections: opts.contextJson ? kbSectionsFromContext(opts.contextJson) : [],
    source: opts.source,
  };
}
