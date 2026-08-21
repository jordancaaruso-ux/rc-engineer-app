import { parseChoiceChipsFromReply } from "@/lib/engineerPhase5/engineerChoiceChips";

/** Auto-title from the first user message in a thread. */
export function engineerThreadTitleFromContent(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New chat";
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}

/** How much of the answer a history preview carries. Two lines at 390px, roughly. */
const ANSWER_PREVIEW_CHARS = 150;

/**
 * A plain-text taste of what the Engineer actually said, for the history card's previews
 * (founder call 2026-08-20).
 *
 * The title is built from the driver's QUESTION, so a preview of the question would print the
 * same words twice. This carries the answer instead — the half of the exchange the driver is
 * scanning for when they open history looking for "the one where it told me about droop".
 *
 * Everything markdown-shaped comes out. The transcript renders through `EngineerMarkdown`, so a
 * reply arrives full of headings, bullets, bold lever names and the occasional table, and a
 * preview that showed `**Front droop**` or a leading `## ` would read as a bug. The follow-up
 * chip marker goes too — it is a control, not prose.
 */
export function engineerAnswerPreviewFromContent(content: string): string | null {
  const withoutChips = parseChoiceChipsFromReply(content).text;

  const plain = withoutChips
    // Fenced code and tables are structure, not a sentence — drop the fences and pipes.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*$/gm, " ")
    // Links and images keep their words, lose their target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Leading block syntax: headings, quotes, bullets, ordered markers.
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    // Emphasis and inline code markers, left where the words are.
    .replace(/(\*\*|__|\*|_|`)/g, "")
    // Horizontal rules.
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return null;
  return plain.length > ANSWER_PREVIEW_CHARS
    ? `${plain.slice(0, ANSWER_PREVIEW_CHARS - 1).trimEnd()}…`
    : plain;
}
