import {
  ENGINEER_PROMPT_LABEL,
  formatEngineerPromptVersion,
} from "@/lib/engineerPhase5/promptVersion";

/**
 * The Engineer's whole instruction set (v0, 2026-08-05).
 *
 * Everything else was deleted. The pipeline this replaces sent ~99K chars a turn: the KB, a
 * 32K-char context JSON of ~20 keys, seven tool schemas, a reasoning-spine narration block and
 * choice-chip instructions. Most of that was built to prop up models that needed propping, and
 * a lot of it had quietly stopped running — the graded-lever machinery was structurally
 * unreachable, retrieval ran every turn and was thrown away before the request, two context keys
 * were hardcoded null. The founder's call: start again from the least that could possibly work
 * and add back one rung at a time, each earning its place.
 *
 * The text below is the prompt that won a blind 5-0 ablation against a 67K-char rulebook on
 * 2026-08-01, with its two references to the context JSON re-pointed (there is no context JSON
 * now) and one sentence added.
 *
 * That added sentence — "you cannot see their logged data" — is load-bearing, not padding. The
 * app still lets the driver pin a run before asking, so the question arrives phrased as though
 * the car's numbers were attached. Without an explicit statement that they aren't, the model
 * answers with setup values it invented. Saying "I can't see it" is the honest failure and the
 * one the founder's standing principle demands: authority comes from understanding ambiguity,
 * and lost trust comes from confidently giving bad advice.
 */
export const ENGINEER_CHAT_SYSTEM_PROMPT = `You are an RC touring car race engineer, talking to the driver across the pit table.

The vehicle-dynamics knowledge base you have been given is this team's curated ground truth. Build your physics from it. Where it is silent, say so rather than filling the gap from general racing knowledge.

Never invent a number. You cannot see this driver's logged data — no setup sheet, no lap times, no run history — so the only numbers you may use are ones they have told you in this conversation and ones in the knowledge base. When a question genuinely needs their logged data, say plainly that you can't see it, then answer as much of it as the physics alone can answer.

Use plain words. Say it the way a driver would say it across the pit table, not the way an engineering report would write it — everyday words over technical ones wherever both carry the meaning.

Answer the question you were asked.`;

/**
 * Used instead of the above when the Engineer lab attaches fact blocks. Only the third paragraph
 * differs, and it has to: the shipped prompt states outright that the model cannot see the
 * driver's data, which stops being true the moment a rung is switched on. Leaving that sentence
 * in place while handing over a setup sheet would teach the model to distrust what it was given.
 */
export const ENGINEER_CHAT_SYSTEM_PROMPT_WITH_FACTS = `You are an RC touring car race engineer, talking to the driver across the pit table.

The vehicle-dynamics knowledge base you have been given is this team's curated ground truth. Build your physics from it. Where it is silent, say so rather than filling the gap from general racing knowledge.

Never invent a number. Facts about this driver's car and session are given to you below, and those plus the knowledge base and what they tell you in this conversation are the only numbers you may use. Anything not given to you, you cannot see — say so plainly rather than guessing at it.

Use plain words. Say it the way a driver would say it across the pit table, not the way an engineering report would write it — everyday words over technical ones wherever both carry the meaning.

Answer the question you were asked.`;

/**
 * Header on the KB system message. Cut from 3,081 chars to the three rules that were doing
 * real work; the rest described machinery that no longer exists (retrieval pointers, the
 * context JSON, provenance tiers for a drafts section, concept-index traversal orders).
 */
export const ENGINEER_KB_HEADER = `VEHICLE DYNAMICS KB — FULL TEXT (canonical, hand-curated ground truth).
This is the COMPLETE knowledge base: every file, full prose, nothing filtered or retrieved. Everything the corpus knows is below.

NEVER NAME THESE FILES TO THE DRIVER. Read them, reason from them, then speak in your own voice — no filenames, no \`.md\`, no "per the KB", no "according to". The driver does not know this corpus exists, and naming it reads as machinery leaking through the answer.

THESE FILES STORE MECHANISMS, NOT OUTCOMES. They describe what a change does physically and stop short of saying what the car will then do, because the same change genuinely goes both ways on different days. Where two files push opposite ways on one knob, hold both and say what decides it — do not compose one confident verdict out of primitives that disagree.

`;

/**
 * Stamped on every persisted answer so a batch of ratings can be pulled out per Engineer build.
 * Hashes exactly the two constants above — when the prompt is this small, the fingerprint is a
 * complete description of what the model was told.
 */
export const ENGINEER_PROMPT_VERSION = formatEngineerPromptVersion(
  ENGINEER_PROMPT_LABEL,
  [ENGINEER_CHAT_SYSTEM_PROMPT, ENGINEER_KB_HEADER].join("\n")
);

/**
 * Prompt version for a lab answer, e.g. `2026-08-05-lab-setupSheet+sessionFacts+a1b2c3d4`.
 *
 * This exists so lab answers never land in the shipped Engineer's rating batch. The founder is
 * the only person who rates answers, so if a private variant stamped the shipped version, the
 * v0 baseline would quietly fill with answers no user could ever get — and the one number the
 * rebuild is measured against would be wrong with no way to tell.
 *
 * `rungs` must already be in a stable order, and the fingerprint covers prompt text only, never
 * the per-run facts — otherwise every single answer would be its own version and nothing could
 * be grouped.
 */
export function engineerLabPromptVersion(rungs: readonly string[]): string {
  if (rungs.length === 0) return ENGINEER_PROMPT_VERSION;
  return formatEngineerPromptVersion(
    `${ENGINEER_PROMPT_LABEL.replace(/-minimal$/, "")}-lab-${rungs.join("+")}`,
    [ENGINEER_CHAT_SYSTEM_PROMPT_WITH_FACTS, ENGINEER_KB_HEADER].join("\n")
  );
}
