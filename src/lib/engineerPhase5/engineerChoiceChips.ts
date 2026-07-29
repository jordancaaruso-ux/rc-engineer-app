/**
 * Tap-to-answer choice chips: when the Engineer asks one clarifying question with a
 * small set of likely answers, it appends a machine-readable marker the client renders
 * as buttons (free text stays available). Marker format keeps the model's job trivial
 * and parsing robust — no JSON. Parsing runs in the browser, so no "server-only".
 *
 * Extracted from the retired engineerChatMode.ts (one-mode decision, 2026-07-29):
 * chips were never mode-dependent — asking well is not a situational behaviour.
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

export const CHOICE_CHIP_INSTRUCTIONS = `

TAP-TO-ANSWER (clarifying questions): When — and only when — you need the answer to exactly ONE clarifying question before you can advise, and the likely answers form a small discrete set, append the marker on the FINAL line of your reply: [[choices: Option A | Option B | Option C]] (2–5 options, each ≤ 4 words, e.g. [[choices: Entry | Mid-corner | Exit | Everywhere]]). The app renders them as tap buttons with a free-text fallback — do not mention the marker or the buttons in prose, do not use it for rhetorical questions or option menus of setup changes, and never emit more than one marker per reply.`;
