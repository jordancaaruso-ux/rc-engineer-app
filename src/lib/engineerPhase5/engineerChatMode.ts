/**
 * Engineer chat answer modes — quick (trackside) / normal / deep (at-home).
 * Contracts live in docs/ENGINEER_NORTH_STAR.md ("The two moments"); this module
 * turns them into system-prompt addons appended to CHAT_SYSTEM (same pattern as
 * reasoningSpineSystemPromptAddon). No "server-only": the client mode selector
 * imports the type + parser, and choice-chip parsing runs in the browser.
 */

export type EngineerChatMode = "quick" | "normal" | "deep";

export const ENGINEER_CHAT_MODES: EngineerChatMode[] = ["quick", "normal", "deep"];

export function parseEngineerChatMode(value: unknown): EngineerChatMode {
  if (value === "quick" || value === "deep") return value;
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

export function engineerChatModePromptAddon(mode: EngineerChatMode): string {
  const base =
    mode === "quick" ? QUICK_MODE_ADDON : mode === "deep" ? DEEP_MODE_ADDON : "";
  return base + CHOICE_CHIP_INSTRUCTIONS;
}
