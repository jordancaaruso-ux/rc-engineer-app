/**
 * Founder-calibrated Engineer answer judge (iteration engine, ENGINEER_NORTH_STAR.md
 * blueprint E). Scores 0–10 on the founder's in-app rating scale, few-shot prompted
 * with his real rated exchanges, applying the north-star rubric (ranked failure
 * modes, confidence ladder, prediction discipline). Complements — does not replace —
 * the ship-bar reviewer in reviewEngineerAnswer.ts (1–5, wrong_physics blocker).
 */

import { prisma } from "@/lib/prisma";
import {
  computeOpenAiRetryDelayMs,
  isOpenAiTpmRateLimitError,
  maxOpenAiRateLimitAttempts,
  parseOpenAiRetryAfterMs,
  sleepMs,
} from "@/lib/openAiRetry";

export type JudgeExemplar = {
  question: string;
  answer: string;
  stars: number;
  note: string | null;
};

export type JudgeTag =
  | "false_confidence"
  | "generic_advice"
  | "laundry_list"
  | "over_hedged"
  | "no_prediction"
  | "ignored_context"
  | "wrong_physics"
  | "missing_kb_citation"
  | "good_confidence"
  | "good_grounding"
  | "good_diagnosis";

export type CalibratedJudgeResult = {
  score0to10: number;
  tags: JudgeTag[];
  rationale: string;
};

const JUDGE_TAGS: readonly JudgeTag[] = [
  "false_confidence",
  "generic_advice",
  "laundry_list",
  "over_hedged",
  "no_prediction",
  "ignored_context",
  "wrong_physics",
  "missing_kb_citation",
  "good_confidence",
  "good_grounding",
  "good_diagnosis",
];

function judgeModel(): string {
  return process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o";
}

const JUDGE_SYSTEM_BASE = `You judge answers from an RC touring-car race-engineer AI, scoring 0–10 on the founder's scale (0 = useless/harmful, 5 = mediocre, 8 = genuinely useful, 10 = as good as a top human engineer).

You are calibrated to ONE person's taste — the founder, an experienced RC racer. His demonstrated ratings appear below as exemplars; match his standards, not generic AI-assistant niceness.

His locked rubric (ENGINEER_NORTH_STAR.md), failure modes ranked worst first:
1. FALSE CONFIDENCE — the cardinal sin. Sounding certain on a judgment call or thin data. Over-hedging is preferable to overconfidence.
2. GENERIC / FORUM-TIER — advice that ignores the driver's own runs, setup, and context; anyone could have googled it.
3. LAUNDRY LIST — many simultaneous changes instead of a clear call (a small bundle is OK only when confidence is high and stated).
4. OVER-HEDGING — so wishy-washy it's useless when the call is actually clear.

What great looks like (his craft interview):
- Diagnose before prescribing: an explicit read of what the car is doing and WHY, reasoned aloud; the change falls out of the diagnosis.
- The confidence ladder: decisive when one move clearly stands out; honest tradeoff + a test when genuinely open; "no change — verify" is a first-class call; asks ONE sharp question when a decision-changing input is missing.
- Every suggestion ships with a prediction: expected effect + what to feel for + what would say it didn't work.
- Uses THIS driver's data visibly (his runs, ratings, setup, history) — driver feel treated as real but fallible evidence.
- Physics traceable to the curated KB (file citations like \`damper-oil.md\`); inference beyond KB is flagged as such, never bluffed.

Scoring guidance: an answer with correct physics but no use of the driver's context caps around 5–6. A decisive, cited, context-grounded call with a prediction earns 8+. Any false confidence or wrong physics caps at 3.

Return ONLY valid JSON:
{
  "score0to10": 0-10 integer,
  "tags": [${JUDGE_TAGS.map((t) => `"${t}"`).join(" | ")}],
  "rationale": "2-4 sentences, concrete, referencing the rubric"
}`;

function formatExemplars(exemplars: JudgeExemplar[]): string {
  if (exemplars.length === 0) {
    return "(No founder-rated exemplars provided — judge from the rubric alone.)";
  }
  const blocks = exemplars.map((e, i) => {
    const note = e.note?.trim() ? `\nFounder note: ${e.note.trim()}` : "";
    return `--- Exemplar ${i + 1} — founder scored ${e.stars}/10 ---\nQ: ${e.question.slice(0, 700)}\nA: ${e.answer.slice(0, 1400)}${note}`;
  });
  return `FOUNDER-RATED EXEMPLARS (calibrate to these):\n\n${blocks.join("\n\n")}`;
}

/**
 * Pull founder-rated exchanges as calibration exemplars, stratified across the score
 * range (low / mid / high) and preferring rows with notes. contextSnapshot rows are
 * written by persistExchange at rating time and carry question + answer.
 */
export async function loadFounderRatedExemplars(params: {
  userId: string;
  maxExemplars?: number;
}): Promise<JudgeExemplar[]> {
  const max = Math.max(1, Math.min(params.maxExemplars ?? 10, 20));
  const rows = await prisma.engineerMessageRating.findMany({
    where: { userId: params.userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { stars: true, note: true, contextSnapshot: true },
  });

  const parsed: JudgeExemplar[] = [];
  for (const r of rows) {
    const snap = r.contextSnapshot as Record<string, unknown> | null;
    const question = typeof snap?.question === "string" ? snap.question.trim() : "";
    const answer = typeof snap?.answer === "string" ? snap.answer.trim() : "";
    if (!question || !answer) continue;
    parsed.push({ question, answer, stars: r.stars, note: r.note ?? null });
  }

  const withNoteFirst = (a: JudgeExemplar, b: JudgeExemplar) =>
    Number(Boolean(b.note?.trim())) - Number(Boolean(a.note?.trim()));
  const low = parsed.filter((e) => e.stars <= 4).sort(withNoteFirst);
  const mid = parsed.filter((e) => e.stars >= 5 && e.stars <= 7).sort(withNoteFirst);
  const high = parsed.filter((e) => e.stars >= 8).sort(withNoteFirst);

  // Stratify so the judge sees his bad, mediocre, and great — not just one band.
  const perBucket = Math.max(1, Math.floor(max / 3));
  const picked = [
    ...low.slice(0, perBucket + (max % 3 > 0 ? 1 : 0)),
    ...mid.slice(0, perBucket),
    ...high.slice(0, perBucket + (max % 3 > 1 ? 1 : 0)),
  ];
  // Dedupe by question (same question rated across sessions).
  const seen = new Set<string>();
  return picked.filter((e) => {
    const k = e.question.slice(0, 200).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseJudgeJson(content: string): CalibratedJudgeResult | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawScore = obj.score0to10;
  const score =
    typeof rawScore === "number" && Number.isFinite(rawScore)
      ? Math.max(0, Math.min(10, Math.round(rawScore)))
      : null;
  if (score == null) return null;
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is JudgeTag => JUDGE_TAGS.includes(t as JudgeTag))
    : [];
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  return { score0to10: score, tags, rationale };
}

export async function judgeEngineerAnswer(params: {
  question: string;
  answer: string;
  exemplars: JudgeExemplar[];
  kbSections?: string[];
}): Promise<CalibratedJudgeResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const system = `${JUDGE_SYSTEM_BASE}\n\n${formatExemplars(params.exemplars)}`;
  const userPayload = {
    question: params.question,
    answer: params.answer,
    kbSectionsRetrieved: params.kbSections ?? [],
  };

  const body = JSON.stringify({
    model: judgeModel(),
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const maxAttempts = maxOpenAiRateLimitAttempts();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) {
      // The judge shares TPM with the (large) answer calls — retry on rate limits.
      if (isOpenAiTpmRateLimitError(data, res.status) && attempt < maxAttempts - 1) {
        await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
        continue;
      }
      throw new Error(data.error?.message ?? `Judge OpenAI error (${res.status})`);
    }
    const parsed = parseJudgeJson(data.choices?.[0]?.message?.content ?? "");
    if (!parsed) throw new Error("Judge returned unparseable JSON");
    return parsed;
  }
  throw new Error("Judge rate-limited after retries");
}
