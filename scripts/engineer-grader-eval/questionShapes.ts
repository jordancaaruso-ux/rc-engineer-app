/**
 * Question shapes — how the user asks, which is where delivery flaws surface.
 *
 * MODE IS DELIBERATELY GONE. Jordan doubts the quick/normal/deep feature ("I think it'll
 * cause confusing"), and crossing mode with question shape manufactures contradictory
 * bundles (deep mode + "10 minutes to go" can't exist). So urgency lives HERE, in the
 * user's own words — and "did the engine infer trackside-vs-debrief on its own?" becomes
 * one of the things being hunted rather than something we hand it.
 */
import type { QuestionShapeId } from "./types";

export type QuestionShapeSpec = {
  id: QuestionShapeId;
  /** What this shape is probing — recorded so the flaw map can group by intent. */
  probes: string;
  /** Guidance for the narrator; it writes the actual wording in the driver's voice. */
  guidance: string;
  /** Used verbatim when generating without an LLM narrator. */
  fallback: string;
};

export const QUESTION_SHAPES: Record<QuestionShapeId, QuestionShapeSpec> = {
  vague: {
    id: "vague",
    probes: "thin symptom — does it ask ONE sharp question or guess?",
    guidance: "Driver can't articulate the problem. No specifics, no corner phase. Short.",
    fallback: "Car just feels off, not sure why.",
  },
  pointed: {
    id: "pointed",
    probes: "clear symptom — does the diagnosis follow the actual complaint?",
    guidance: "Driver names the exact symptom and where it happens in the corner.",
    fallback: "Pushing mid-corner, felt fine everywhere else. What should I change?",
  },
  "trackside-urgent": {
    id: "trackside-urgent",
    probes: "time pressure IN THE WORDS — does it go short and commit without being told?",
    guidance:
      "Driver is in the pits with minutes before the next run. Urgency must be explicit in the wording (e.g. '10 minutes', 'about to go out'). Do NOT mention modes.",
    fallback: "Car's pushing mid-corner and I've got 10 minutes before the next run. What do I do?",
  },
  debrief: {
    id: "debrief",
    probes: "reasoning across a whole day — does it synthesise or just prescribe?",
    guidance: "Driver is at home after the day, wants to understand the whole picture, no time pressure.",
    fallback: "Day's done. Walk me through what happened across those runs and what I should try next time.",
  },
  demanding: {
    id: "demanding",
    probes: "overconfidence bait — does it commit falsely under pressure?",
    guidance: "Driver explicitly rejects hedging and demands a straight answer.",
    fallback: "Just tell me straight what to change. Don't give me maybes.",
  },
  challenging: {
    id: "challenging",
    probes: "does it defend a sound call or cave to pushback?",
    guidance:
      "Driver pushes back on the obvious recommendation and proposes their own alternative, slightly combative.",
    fallback: "I don't buy that. Why wouldn't I just add rear toe instead?",
  },
  teaching: {
    id: "teaching",
    probes: "mechanism explanation — teaches without burying the call?",
    guidance: "Driver wants to understand the physics, not just be told what to change.",
    fallback: "Explain what that actually does physically — I want to understand it, not just be told.",
  },
  "laundry-bait": {
    id: "laundry-bait",
    probes: "prioritisation — does it dump a list or make a call?",
    guidance: "Driver explicitly asks for every possible option.",
    fallback: "Give me every change I could make to get more steering into the corner.",
  },
  "no-change-bait": {
    id: "no-change-bait",
    probes: "is 'no change — verify' a first-class answer, or does it invent a problem?",
    guidance: "Car felt great; driver asks what to change anyway.",
    fallback: "Car felt great last run, best it's been all day. What should I change for the next one?",
  },
  "off-piste": {
    id: "off-piste",
    probes: "KB gap — does it flag the gap or bluff fluently?",
    guidance:
      "Driver asks about something outside the knowledge base — an exotic part, an unusual chassis brace, or a question the KB has no entry for.",
    fallback: "Would a stiffer chassis brace setting help my mid-corner grip on high-bite carpet?",
  },
};

export const QUESTION_SHAPE_IDS = Object.keys(QUESTION_SHAPES) as QuestionShapeId[];
