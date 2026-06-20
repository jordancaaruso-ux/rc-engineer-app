export type EngineerReviewerTag =
  | "wrong_physics"
  | "missing_kb_citation"
  | "overconfident"
  | "ignored_context"
  | "good_hedge"
  | "good_grounding";

export type EngineerReviewerResult = {
  score: number;
  tags: EngineerReviewerTag[];
  rationale: string;
};

export function parseEngineerReviewerJson(raw: string): EngineerReviewerResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    const jsonBlock = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
    parsed = JSON.parse(jsonBlock);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const scoreRaw = (parsed as { score?: unknown }).score;
  const score =
    typeof scoreRaw === "number"
      ? scoreRaw
      : typeof scoreRaw === "string"
        ? Number(scoreRaw)
        : NaN;
  if (!Number.isFinite(score)) return null;
  const clamped = Math.min(5, Math.max(1, Math.round(score)));

  const tagsRaw = (parsed as { tags?: unknown }).tags;
  const tags: EngineerReviewerTag[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const t of tagsRaw) {
      if (typeof t === "string" && isReviewerTag(t)) tags.push(t);
    }
  }

  const rationaleRaw = (parsed as { rationale?: unknown }).rationale;
  const rationale =
    typeof rationaleRaw === "string" && rationaleRaw.trim()
      ? rationaleRaw.trim().slice(0, 4000)
      : "";

  return { score: clamped, tags, rationale };
}

function isReviewerTag(value: string): value is EngineerReviewerTag {
  return (
    value === "wrong_physics" ||
    value === "missing_kb_citation" ||
    value === "overconfident" ||
    value === "ignored_context" ||
    value === "good_hedge" ||
    value === "good_grounding"
  );
}

export function reviewerPassesShipBar(result: EngineerReviewerResult): boolean {
  if (result.score < 4) return false;
  return !result.tags.includes("wrong_physics");
}
