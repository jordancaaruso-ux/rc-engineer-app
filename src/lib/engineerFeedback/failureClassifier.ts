/**
 * Rubric-decomposed failure classifier — ENGINEER_SUGGESTION_QUALITY_PLAN.md, step 1.
 *
 * The calibrated judge (calibratedJudge.ts) emits an aggregate 0–10 score plus tags, but
 * it has NO misdiagnosis tag and collapses the rubric into one number. This classifier
 * decomposes an answer along the north-star rubric dimensions and — crucially — measures
 * the one failure class the judge is blind to: `misdiagnosis`. It also measures the
 * false-confidence VETO independently of the aggregate score, which the plan requires so
 * calibration failures can move without the score moving.
 *
 * This is a classifier, not a scorer: it does not replace the judge on the ship path. It
 * runs offline over bench results + rated production answers to publish the failure
 * distribution that decides the diagnosis-vs-calibration keystone.
 */

import {
  computeOpenAiRetryDelayMs,
  isOpenAiTpmRateLimitError,
  maxOpenAiRateLimitAttempts,
  parseOpenAiRetryAfterMs,
  sleepMs,
} from "@/lib/openAiRetry";
import {
  FAILURE_CLASSES,
  SECONDARY_FAILURE_SIGNALS,
  primaryFailureFromClasses,
  type FailureClass,
  type SecondaryFailureSignal,
} from "./failureTaxonomy";

/**
 * Whether the physics the answer NEEDED falls inside current KB coverage — the split that
 * keeps an incomplete KB from inflating the misdiagnosis count (plan step 1, coverage
 * refinement). `kb_gap` failures point at the KB-completion sweep; `in_kb` failures point
 * at the diagnosis/calibration keystones.
 */
export type CoverageAttribution =
  | "in_kb" // needed physics is in the coverage manifest
  | "kb_gap" // answer's core topic is absent from the manifest
  | "mixed" // partially covered
  | "not_applicable" // failure isn't about physics coverage (pure genericness / laundry / no-prediction)
  | "unknown"; // no manifest supplied, cannot assess

/** Per-dimension rubric decomposition. Higher = better; each names its worst failure. */
export type FailureRubric = {
  /** 0–3 — correctly reads what the car is doing and WHY. 0 ⇒ misdiagnosis. */
  diagnosis: number;
  /** 0–3 — confidence matched to evidence (both false-confidence and over-hedge cost points). */
  calibration: number;
  /** 0–3 — uses THIS driver's runs/setup/context vs forum-tier. 0 ⇒ genericness. */
  specificity: number;
  /** 0–3 — one prioritized testable move vs a laundry list. 0 ⇒ laundry_list. */
  actionability: number;
  /** 0–1 — ships a checkable prediction (expected effect + falsifier). */
  prediction: number;
};

export type AnswerFailureAnalysis = {
  rubric: FailureRubric;
  /** All failure classes present (worst-first). */
  failureClasses: FailureClass[];
  /** Single worst failure, or null when the answer is clean. */
  primaryFailure: FailureClass | null;
  /** The cardinal sin, measured on its own: claimed a decisiveness the evidence can't license.
   *  Tracked separately from `miscalibration` (which also covers over-hedging). */
  falseConfidenceVeto: boolean;
  secondarySignals: SecondaryFailureSignal[];
  /** Did the answer's needed physics fall inside KB coverage? Splits reasoning failures
   *  from coverage gaps. `unknown` when no manifest was supplied. */
  coverage: CoverageAttribution;
  rationale: string;
};

function classifierModel(): string {
  return process.env.ENGINEER_FAILURE_CLASSIFIER_MODEL?.trim() || process.env.ENGINEER_JUDGE_MODEL?.trim() || "gpt-4o";
}

const CLASSIFIER_SYSTEM = `You are a QA analyst for an RC touring-car race-engineer AI. You do NOT score answers on a scale — you DIAGNOSE how an answer fails, decomposing it along a fixed rubric and labelling its failure classes. Judge by the founder's locked north-star rubric, not generic-assistant niceness.

You are given the driver's QUESTION and the AI's ANSWER (and any KB sections it had). Assess these rubric dimensions:

- diagnosis (0-3): Does the answer contain an explicit, correct read of what the car is doing and WHY (loads, roll, weight transfer, tyre/track state separated from chassis)? 3 = clear correct causal read; 1 = shallow/partly wrong; 0 = the read is WRONG or absent (this is a MISDIAGNOSIS).
- calibration (0-3): Is the stated confidence exactly as strong as the evidence allows? Penalise BOTH directions: sounding certain on a judgment call or thin data (worse), AND being so wishy-washy it's useless when the call is clearly one move. 3 = confidence tracks evidence; 0 = badly miscalibrated either way.
- specificity (0-3): Does it visibly use THIS driver's runs, setup, ratings, history? 3 = clearly grounded in the driver's own data; 0 = generic forum-tier advice anyone could have googled (GENERICNESS).
- actionability (0-3): Is there ONE prioritised, testable move (a small bundle only if confidence is high and stated)? 3 = one clear call; 0 = a laundry list of simultaneous changes (LAUNDRY_LIST).
- prediction (0-1): Does every suggestion ship with a checkable prediction — expected effect + what to feel for + what would say it didn't work? 1 = yes; 0 = no.

Then assign FAILURE CLASSES (a dimension can be weak without being a failure — only flag genuine failures):
- "misdiagnosis" — the causal read is wrong or absent (diagnosis ~0-1 AND it mattered).
- "miscalibration" — confidence not matched to evidence, EITHER direction.
- "genericness" — ignores the driver's own data; forum-tier.
- "laundry_list" — many simultaneous changes instead of one prioritised call.

Set falseConfidenceVeto=true ONLY for the specific cardinal sin: the answer asserts a decisiveness the evidence/diagnosis cannot license (false confidence). Over-hedging is miscalibration but NOT a veto.

Secondary signals (real but separate from the four classes):
- "no_prediction" — violates prediction discipline (prediction=0).
- "wrong_physics" — a mechanism claim that is physically wrong.
- "missing_kb_citation" — a physics claim that should cite the KB but doesn't.

COVERAGE ATTRIBUTION — critical for interpreting knowledge failures. You may be given a KB COVERAGE MANIFEST listing what the approved knowledge base actually covers (files, sections, parameter keys). Judge whether the physics THIS answer needed falls inside that coverage, and set "coverage":
- "in_kb" — the needed physics IS in the manifest, so a wrong/absent read is a genuine reasoning failure.
- "kb_gap" — the answer's core topic is ABSENT from the manifest; any physics failure here is a coverage gap, not a reasoning failure (the correct behaviour on a gap is to hedge, cap confidence, and flag it — grade that behaviour, but attribute the cause to the gap).
- "mixed" — partially covered.
- "not_applicable" — the failure is not about physics coverage (pure genericness / laundry-list / missing-prediction with no physics error).
- "unknown" — only if NO manifest was provided.
Do NOT invent coverage: if a topic is not in the manifest, it is a gap even if the physics is real-world true.

Return ONLY valid JSON:
{
  "rubric": { "diagnosis": 0-3, "calibration": 0-3, "specificity": 0-3, "actionability": 0-3, "prediction": 0-1 },
  "failureClasses": ["misdiagnosis" | "miscalibration" | "genericness" | "laundry_list"],
  "falseConfidenceVeto": boolean,
  "secondarySignals": ["no_prediction" | "wrong_physics" | "missing_kb_citation"],
  "coverage": "in_kb" | "kb_gap" | "mixed" | "not_applicable" | "unknown",
  "rationale": "2-3 sentences naming the deciding rubric points"
}`;

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : lo;
  return Math.max(lo, Math.min(hi, n));
}

function parseAnalysis(content: string): AnswerFailureAnalysis | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const r = (obj.rubric ?? {}) as Record<string, unknown>;
  const rubric: FailureRubric = {
    diagnosis: clampInt(r.diagnosis, 0, 3),
    calibration: clampInt(r.calibration, 0, 3),
    specificity: clampInt(r.specificity, 0, 3),
    actionability: clampInt(r.actionability, 0, 3),
    prediction: clampInt(r.prediction, 0, 1),
  };
  const rawClasses = Array.isArray(obj.failureClasses) ? obj.failureClasses : [];
  const present = new Set(
    rawClasses.filter((c): c is FailureClass => (FAILURE_CLASSES as readonly string[]).includes(c as string))
  );
  const failureClasses = FAILURE_CLASSES.filter((c) => present.has(c));
  const rawSecondary = Array.isArray(obj.secondarySignals) ? obj.secondarySignals : [];
  const secondarySignals = SECONDARY_FAILURE_SIGNALS.filter((s) =>
    (rawSecondary as unknown[]).includes(s)
  );
  const COVERAGE = ["in_kb", "kb_gap", "mixed", "not_applicable", "unknown"] as const;
  const coverage = (COVERAGE as readonly string[]).includes(obj.coverage as string)
    ? (obj.coverage as CoverageAttribution)
    : "unknown";
  return {
    rubric,
    failureClasses,
    primaryFailure: primaryFailureFromClasses(failureClasses),
    falseConfidenceVeto: obj.falseConfidenceVeto === true,
    secondarySignals,
    coverage,
    rationale: typeof obj.rationale === "string" ? obj.rationale.trim() : "",
  };
}

async function postClassifierCompletion(body: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const maxAttempts = maxOpenAiRateLimitAttempts();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!res.ok) {
      if (isOpenAiTpmRateLimitError(data, res.status) && attempt < maxAttempts - 1) {
        await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
        continue;
      }
      throw new Error(data.error?.message ?? `Failure-classifier OpenAI error (${res.status})`);
    }
    return data.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("Failure classifier rate-limited after retries");
}

/** Classify one answer's failures. Costs one OpenAI call — run deliberately (offline).
 *  Pass `kbCoverageManifest` (from kbCoverageManifest.ts) so coverage attribution can
 *  split reasoning failures from KB gaps; without it, coverage is "unknown". */
export async function classifyAnswerFailures(params: {
  question: string;
  answer: string;
  kbSections?: string[];
  kbCoverageManifest?: string;
}): Promise<AnswerFailureAnalysis> {
  const manifest = params.kbCoverageManifest?.trim();
  const system = manifest
    ? `${CLASSIFIER_SYSTEM}\n\nKB COVERAGE MANIFEST (ground truth of what the approved KB covers):\n${manifest}`
    : `${CLASSIFIER_SYSTEM}\n\n(No KB coverage manifest supplied — set "coverage" to "unknown".)`;
  const body = JSON.stringify({
    model: classifierModel(),
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          question: params.question,
          answer: params.answer,
          kbSectionsRetrieved: params.kbSections ?? [],
        }),
      },
    ],
  });
  const parsed = parseAnalysis(await postClassifierCompletion(body));
  if (!parsed) throw new Error("Failure classifier returned unparseable JSON");
  return parsed;
}
