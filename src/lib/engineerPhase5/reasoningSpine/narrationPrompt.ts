import "server-only";

import type { ReasoningSpineV1 } from "@/lib/engineerPhase5/reasoningSpine/types";

const ROUTE_NARRATION: Record<ReasoningSpineV1["route"], string> = {
  setup_advice:
    "Answer as setup advice: diagnosis first (from problemStatement + engineeringBrain), then levers. Match technical depth to the user.",
  planning:
    "Answer as race-meeting prep: summarize what changed recently, tire life, conditional empirical at this track, and 1–3 prioritized experiments — not a full setup lecture.",
  data_query:
    "This route is usually answered deterministically before the LLM. If you still see it, answer with numbers from context only — no invented laps.",
  comparison:
    "Answer as a comparison: tire vs tire or run vs run — cite pace, setup deltas, and hedges when tire index or venue differs.",
  conceptual:
    "Answer as theory: lean on vehicleDynamicsKb excerpts; no prescription unless the user also asked what to change.",
};

export function reasoningSpineSystemPromptAddon(spine: ReasoningSpineV1 | null | undefined): string {
  if (!spine || spine.version !== 1) return "";

  const routeBlock = ROUTE_NARRATION[spine.route] ?? "";
  const tierBlock =
    spine.decisionTier === "engine_decides"
      ? `REASONING_SPINE (engine_decides — LOCK):
When "reasoningSpine.decisionTier" is "engine_decides", you MUST:
- Use reasoningSpine.promptLines and gradedLevers as the authoritative lever list and order.
- NOT add parameters outside gradedLevers, NOT reverse recommendedMoveDirection, NOT skip KB citations (kbSource/kbSection per lever).
- Still explain mechanism in driver language and surface confounders from problemStatement.
- Honour PARAMETER CHANGE RECOMMENDATIONS (current value + community median + KB cite) for each lever you mention.`
      : `REASONING_SPINE (grounded_reasoner_fallback):
When "reasoningSpine.decisionTier" is "grounded_reasoner_fallback", use reasoningSpine.problemStatement and promptLines as diagnosis scaffolding.
You may reason beyond gradedLevers when the catalog is empty or evidence is thin, but:
- Do not invent physics outside vehicleDynamicsKb.
- Hedge when problemStatement.confounders is non-empty or diagnosisConfidence is low.
- Personal history and setupOutcomeMemory modulate certainty only — never override KB direction from anecdote.`;

  return `

REASONING SPINE (orchestration layer — prefer over re-deriving intent from raw message):
Route: ${spine.route}. ${routeBlock}
${tierBlock}
Read reasoningSpine.promptLines in the context JSON — they are deterministic and should anchor your reply structure.`;

}
