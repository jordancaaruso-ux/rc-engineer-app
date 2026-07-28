/**
 * Engineer chat answer situations — quick (trackside) / normal / deep (at-home).
 * Contracts live in docs/ENGINEER_NORTH_STAR.md ("The two moments"); this module
 * turns them into system-prompt addons appended to CHAT_SYSTEM (same pattern as
 * reasoningSpineSystemPromptAddon). Choice-chip parsing runs in the browser, so
 * no "server-only".
 *
 * Founder decision 2026-07-28: the explicit quick/normal/deep selector is RETIRED.
 * It asked the driver to classify their own question before asking it — a tax paid
 * every message, in the one moment (between runs, gloves on) where taps are dearest.
 * The two contracts below are not retired; they were always the valuable part. The
 * server now infers which one applies from the signals ENGINEER_NORTH_STAR.md already
 * listed as the "Later" step, and the prompt tells the model to follow the driver's
 * lead when the message contradicts the inference.
 */

export type EngineerChatMode = "quick" | "normal" | "deep";

/**
 * A caller that already knows the driver's situation better than any inference can —
 * currently the dashboard's "today" card, which only appears on a race day. Not a user
 * preference and never persisted: it describes where the tap came FROM.
 */
export function parseEngineerChatModeHint(value: unknown): EngineerChatMode | null {
  return value === "quick" || value === "deep" || value === "normal" ? value : null;
}

/** Within this of the last logged run, treat the driver as still at the track. */
const TRACKSIDE_WINDOW_MS = 3 * 60 * 60 * 1000;
const DEBRIEF_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * Infer the answer contract from where the driver is in their day.
 *
 * - Logged a run in the last three hours → they are between runs. Quick.
 * - An event run in the last day and a half, but not in that window → they have packed
 *   up and are thinking about it. Deep.
 * - Anything else (cold weekday, no recent running) → Normal.
 *
 * Deliberately coarse. A wrong guess costs the driver a slightly differently-shaped
 * answer, not a wrong one — every contract shares the same grounding and hedging rules —
 * and the prompt lets the model override it when the message says otherwise.
 */
export function inferEngineerChatMode(input: {
  latestRunCreatedAtIso?: string | null;
  latestRunEventId?: string | null;
  nowMs: number;
}): EngineerChatMode {
  const iso = input.latestRunCreatedAtIso?.trim();
  if (!iso) return "normal";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "normal";
  const age = input.nowMs - then;
  if (age < 0) return "normal";
  if (age <= TRACKSIDE_WINDOW_MS) return "quick";
  if (input.latestRunEventId && age <= DEBRIEF_WINDOW_MS) return "deep";
  return "normal";
}

/**
 * Tap-to-answer choice chips: when the Engineer asks one clarifying question with a
 * small set of likely answers, it appends a machine-readable marker the client renders
 * as buttons (free text stays available). Marker format keeps the model's job trivial
 * and parsing robust — no JSON.
 */
export const CHOICE_CHIP_MARKER_RE = /\n?\[\[choices:([^\]]+)\]\]\s*$/i;

export function parseChoiceChipsFromReply(content: string): {
  text: string;
  choices: string[] | null;
} {
  const m = content.match(CHOICE_CHIP_MARKER_RE);
  if (!m) return { text: content, choices: null };
  const choices = m[1]
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 40)
    .slice(0, 5);
  if (choices.length < 2) return { text: content.replace(CHOICE_CHIP_MARKER_RE, "").trimEnd(), choices: null };
  return { text: content.replace(CHOICE_CHIP_MARKER_RE, "").trimEnd(), choices };
}

const CHOICE_CHIP_INSTRUCTIONS = `

TAP-TO-ANSWER (clarifying questions): When — and only when — you need the answer to exactly ONE clarifying question before you can advise, and the likely answers form a small discrete set, append the marker on the FINAL line of your reply: [[choices: Option A | Option B | Option C]] (2–5 options, each ≤ 4 words, e.g. [[choices: Entry | Mid-corner | Exit | Everywhere]]). The app renders them as tap buttons with a free-text fallback — do not mention the marker or the buttons in prose, do not use it for rhetorical questions or option menus of setup changes, and never emit more than one marker per reply.`;

const QUICK_MODE_ADDON = `

ANSWER MODE — QUICK (trackside, locked contract from ENGINEER_NORTH_STAR.md):
The driver is between runs with ~10–15 minutes to make a setup decision. A wall of text is a failure here.
1. **Lead with the read** (1–2 lines): interpret their car rating + handling details from the log into what you think is going on. Don't make them re-explain what they already logged.
2. **Then the call**: ONE change (with the KB-cited why in a line, per the parameter recommendation rules) plus what should feel different next run so they can verify it worked. "No change — get another run on this and watch for X" is a first-class recommendation when evidence says the setup isn't the problem or the last change needs verification.
3. **Ask instead of guessing**: if a decision-changing input is missing, ask ONE sharp question (use the tap-to-answer marker) instead of advising — but only when the answer would genuinely change the call.
Hard limits: target ≤ 150 words; no mechanism teaching unless asked; no option menus — commit per the confidence rules, or say plainly that it's a judgment call and name the single best test. All grounding, citation, and hedging rules above still apply — brevity never licenses false confidence.`;

const DEEP_MODE_ADDON = `

ANSWER MODE — DEEP (at-home debrief, locked contract from ENGINEER_NORTH_STAR.md):
The driver is off the clock — post-session or post-event, with time to think and discuss. Be a thinking partner, not a vending machine:
- **Debrief across runs** when the context covers a day/event: what changed, what worked, patterns they'd miss.
- **Explore hypotheses and what-ifs** ("what if I'd gone stiffer?") — reason from KB mechanism, separate what physics predicts from what only a test can confirm.
- **Teach the mechanism** behind your reasoning (KB-grounded) so the driver builds their own intuition — depth means better reasoning, not more simultaneous recommendations.
- **Real back-and-forth**: ask clarifying questions freely, challenge their read when the data disagrees, and when natural end with the next question or experiment worth exploring.
All grounding, citation, and hedging rules above still apply.`;

/**
 * The driver no longer picks the contract, so the model must be told the shape it was
 * handed is a guess about their situation — never a constraint on what they asked for.
 */
const INFERRED_SITUATION_NOTE = `

HOW YOU GOT THIS ANSWER MODE: it was inferred from how recently the driver logged a run, not chosen by them. Never mention it, never name the mode, and never justify your answer's length by it. If the message contradicts the inference — a trackside-shaped driver asking "why does that work?", or an at-home-shaped driver asking for one quick call — follow the MESSAGE, not the mode.`;

export function engineerChatModePromptAddon(mode: EngineerChatMode): string {
  const base =
    mode === "quick" ? QUICK_MODE_ADDON : mode === "deep" ? DEEP_MODE_ADDON : "";
  // Choice chips are unconditional (2026-07-28): they used to ride along with the mode
  // addon, so the retired light tier — which skipped the addon — could never render a
  // tap-to-answer question. Asking well is not a mode-specific behaviour.
  return (base ? base + INFERRED_SITUATION_NOTE : "") + CHOICE_CHIP_INSTRUCTIONS;
}
