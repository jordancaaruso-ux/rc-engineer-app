import type { QuickFixConfidence, QuickFixSuggestionV1 } from "@/lib/engineerPhase5/quickFix/quickFixTypes";

type LlmSuggestion = {
  parameter?: string;
  direction?: string;
  amount?: string;
  kbWhy?: string;
  confidence?: string;
  expectedEffect?: string;
  priority?: number;
};

type LlmShape = {
  inferredIssue?: string;
  suggestions?: LlmSuggestion[];
  thinContextNote?: string;
};

function coerceConfidence(raw: unknown): QuickFixConfidence {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

function trimStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function parseQuickFixLlmShape(raw: LlmShape, maxSuggestions = 8): QuickFixSuggestionV1[] {
  if (!Array.isArray(raw.suggestions)) return [];
  const out: QuickFixSuggestionV1[] = [];
  for (const item of raw.suggestions.slice(0, maxSuggestions)) {
    const parameter = trimStr(item.parameter, 80);
    const direction = trimStr(item.direction, 120);
    const amount = trimStr(item.amount, 120);
    const kbWhy = trimStr(item.kbWhy, 400);
    const expectedEffect = trimStr(item.expectedEffect, 240);
    if (!parameter || !direction || !kbWhy) continue;
    const priority =
      typeof item.priority === "number" && Number.isFinite(item.priority)
        ? Math.max(1, Math.min(99, Math.round(item.priority)))
        : out.length + 1;
    out.push({
      parameter,
      direction,
      amount: amount || "see direction",
      kbWhy,
      confidence: coerceConfidence(item.confidence),
      expectedEffect: expectedEffect || "Should improve the reported handling issue.",
      priority,
    });
  }
  out.sort((a, b) => a.priority - b.priority);
  return out;
}

export function trimQuickFixStr(s: unknown, max: number): string {
  return trimStr(s, max);
}
