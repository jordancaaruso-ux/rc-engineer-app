/**
 * Starter questions for the Engineer page — the written prompts a driver taps
 * instead of facing an empty box (founder call, 2026-08-18).
 *
 * Two rules shape everything here:
 *
 * 1. **A tap fills the composer, it never sends.** The `text` is a starting
 *    point the driver edits — which corner, which round — before hitting send.
 *    A mis-tap costs nothing, and it can't spend a request from the monthly cap.
 * 2. **They only exist on an empty thread.** Once the Engineer has replied it
 *    emits its own follow-up chips (`parseChoiceChipsFromReply`), and two
 *    competing chip systems on one screen is a mess.
 *
 * `label` is what fits on a rail at 390px. `text` is the real question, phrased
 * the way the Engineer answers best — a symptom with a corner phase attached, or
 * a request for a mechanism rather than a rule of thumb.
 */

export type EngineerStarterFamily = "run" | "feel" | "plan" | "learn";

export type EngineerStarterQuestion = {
  id: string;
  /** Short label on the chip. */
  label: string;
  /** What lands in the composer. The driver edits it before sending. */
  text: string;
  family: EngineerStarterFamily;
};

export type EngineerStarterState = {
  /** A run is the current subject — Auto or pinned. False in General mode. */
  runInFocus: boolean;
  /** The driver has logged at least one run, whether or not it's in focus. */
  hasHistory: boolean;
};

/**
 * Read this run — the trackside moment. The subject bar already names the run,
 * so no chip here ever has to.
 */
const RUN_QUESTIONS: EngineerStarterQuestion[] = [
  {
    id: "run-change",
    label: "What should I change?",
    text: "Read this run and tell me what to change for the next one — or whether to leave it alone and run it again.",
    family: "run",
  },
  {
    id: "run-faster",
    label: "Was that actually faster?",
    text: "Was this run genuinely faster, or just a cleaner drive? Look at the consistency, not only the best lap.",
    family: "run",
  },
  {
    id: "run-why",
    label: "Why did it feel like that?",
    text: "Explain why the car felt the way I logged it — what in the setup, the tyres or the track is causing it?",
    family: "run",
  },
  {
    id: "run-changed",
    label: "What changed last run?",
    text: "Compare this run with the one before it. What changed on the car, and did it do what I expected?",
    family: "run",
  },
  {
    id: "run-worth",
    label: "Worth changing at all?",
    text: "Is there enough here to justify a change, or should I run it back to see if the last one was repeatable?",
    family: "run",
  },
];

/**
 * Fix a feel — how a driver actually opens a conversation: describing the car,
 * not asking a question. Every one of these works with nothing logged.
 */
const FEEL_QUESTIONS: EngineerStarterQuestion[] = [
  {
    id: "feel-loose-entry",
    label: "Loose on entry",
    text: "The car is loose on corner entry — the rear steps out as I turn in. What do I try first?",
    family: "feel",
  },
  {
    id: "feel-no-rotate",
    label: "Won't rotate mid-corner",
    text: "The car pushes through the middle of the corner and won't rotate. Where do I start?",
    family: "feel",
  },
  {
    id: "feel-traction-roll",
    label: "Traction rolling",
    text: "I'm traction rolling in the tight infield. What's the safest change that doesn't cost me steering?",
    family: "feel",
  },
  {
    id: "feel-fade",
    label: "Fades late in the run",
    text: "The car is good for two minutes and then goes away. What causes that, and what do I change?",
    family: "feel",
  },
  {
    id: "feel-bumps",
    label: "Nervous over the bumps",
    text: "It gets nervous and skates over the bumpy section but is fine everywhere else. What do I try?",
    family: "feel",
  },
];

/**
 * Plan ahead — the night-before and between-heats moment. The north star names
 * this as a supported moment; nothing on the page invited it until now.
 */
const PLAN_QUESTIONS: EngineerStarterQuestion[] = [
  {
    id: "plan-new-track",
    label: "First time at this track",
    text: "I'm racing a track I've never been to. What should I find out about it, and what would you start from?",
    family: "plan",
  },
  {
    id: "plan-grip-up",
    label: "Grip came up today",
    text: "The track has picked up a lot of grip since this morning. What changes first, and what do I leave alone?",
    family: "plan",
  },
  {
    id: "plan-cold-damp",
    label: "Cold and damp",
    text: "It's around 8°C and damp today. What does that do to the car, and what do I change for it?",
    family: "plan",
  },
  {
    id: "plan-tyre",
    label: "Which tyre?",
    text: "How do I choose between compounds when I don't have back-to-back data on this surface?",
    family: "plan",
  },
];

/**
 * Teach me — deep mode at home. The family that gets the Engineer opened on a
 * Tuesday night rather than only at the track.
 */
const LEARN_QUESTIONS: EngineerStarterQuestion[] = [
  {
    id: "learn-camber",
    label: "What does front camber do?",
    text: "Explain what front camber actually changes in the car — the mechanism, not a rule of thumb.",
    family: "learn",
  },
  {
    id: "learn-springs",
    label: "Stiffer or softer rear?",
    text: "When do I go stiffer on the rear springs and when do I go softer? What tells me which one I need?",
    family: "learn",
  },
  {
    id: "learn-what-worked",
    label: "What made me faster?",
    text: "Look across my recent runs. Which change actually made me faster, and which ones do I only think helped?",
    family: "learn",
  },
  {
    id: "learn-untouched",
    label: "What am I not looking at?",
    text: "Across my setups and runs, what part of the car have I barely touched that might be holding me back?",
    family: "learn",
  },
];

/** Needs a run as the subject — hidden in General mode and with nothing logged. */
const NEEDS_RUN_IN_FOCUS = new Set(RUN_QUESTIONS.map((q) => q.id));

/** Needs runs to read across, even though the subject can be anything. */
const NEEDS_HISTORY = new Set(["learn-what-worked", "learn-untouched"]);

export const ENGINEER_STARTER_QUESTIONS: EngineerStarterQuestion[] = [
  ...RUN_QUESTIONS,
  ...FEEL_QUESTIONS,
  ...PLAN_QUESTIONS,
  ...LEARN_QUESTIONS,
];

/** Fixed rotation, so the first four on the rail are never four of the same kind. */
const FAMILY_ORDER: EngineerStarterFamily[] = ["run", "feel", "plan", "learn"];

/**
 * Which questions to show, in order.
 *
 * Deliberately deterministic — same state, same chips, same places, every time.
 * Rotating or shuffling them makes the page feel alive to a designer and
 * unreliable to a driver looking for the one they used last round.
 *
 * The rotation deals one question from each family in turn, so the four that fit
 * on a phone rail always span the four kinds of question rather than stacking up
 * as five ways to ask about the same run.
 */
export function selectEngineerStarterQuestions(
  state: EngineerStarterState,
  limit?: number,
): EngineerStarterQuestion[] {
  const eligible = ENGINEER_STARTER_QUESTIONS.filter((q) => {
    if (NEEDS_RUN_IN_FOCUS.has(q.id) && !state.runInFocus) return false;
    if (NEEDS_HISTORY.has(q.id) && !state.hasHistory) return false;
    return true;
  });

  const byFamily = new Map<EngineerStarterFamily, EngineerStarterQuestion[]>();
  for (const family of FAMILY_ORDER) {
    byFamily.set(
      family,
      eligible.filter((q) => q.family === family),
    );
  }

  const ordered: EngineerStarterQuestion[] = [];
  for (let round = 0; ordered.length < eligible.length; round += 1) {
    let tookOne = false;
    for (const family of FAMILY_ORDER) {
      const next = byFamily.get(family)?.[round];
      if (!next) continue;
      ordered.push(next);
      tookOne = true;
    }
    // Safety net: no family had anything left at this depth, so nothing more can arrive.
    if (!tookOne) break;
  }

  return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
}

/** How many the desktop empty-state board lays out. The rail scrolls the rest. */
export const ENGINEER_STARTER_BOARD_COUNT = 6;
