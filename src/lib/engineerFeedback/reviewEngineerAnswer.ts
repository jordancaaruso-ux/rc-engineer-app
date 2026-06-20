import {
  parseEngineerReviewerJson,
  type EngineerReviewerResult,
} from "@/lib/engineerFeedback/reviewerParse";

function getOpenAiKey(): string {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

const REVIEWER_SYSTEM = `You are a strict QA reviewer for an RC touring-car setup Engineer assistant.
Score the assistant answer from 1 (bad) to 5 (excellent).

Rubric:
- KB grounding: cites vehicle-dynamics mechanisms when giving setup direction; no invented physics.
- Physics: roll-centre / shim directions must match curated KB conventions (upper inner lowers RC, etc.).
- Hedge: appropriate uncertainty when context is thin or outcomes are environment-sensitive.
- Context use: uses run/setup/compare context when provided; does not ignore obvious diffs.

Return ONLY valid JSON:
{
  "score": 1-5,
  "tags": ["wrong_physics" | "missing_kb_citation" | "overconfident" | "ignored_context" | "good_hedge" | "good_grounding"],
  "rationale": "one short paragraph"
}

Use tag wrong_physics only for clear contradictions of RC vehicle-dynamics KB or rcEffectHint conventions.`;

function reviewerModel(): string {
  return process.env.ENGINEER_REVIEWER_MODEL?.trim() || "gpt-4o-mini";
}

export async function reviewEngineerAnswer(params: {
  question: string;
  answer: string;
  kbSections?: string[];
  runId?: string | null;
  compareRunId?: string | null;
}): Promise<EngineerReviewerResult> {
  const apiKey = getOpenAiKey();

  const userPayload = {
    question: params.question,
    answer: params.answer,
    kbSectionsRetrieved: params.kbSections ?? [],
    runId: params.runId ?? null,
    compareRunId: params.compareRunId ?? null,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: reviewerModel(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REVIEWER_SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!res.ok) {
    const msg = data.error?.message ?? `Reviewer OpenAI error (${res.status})`;
    throw new Error(msg);
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseEngineerReviewerJson(content);
  if (!parsed) {
    throw new Error("Reviewer returned unparseable JSON");
  }
  return parsed;
}
