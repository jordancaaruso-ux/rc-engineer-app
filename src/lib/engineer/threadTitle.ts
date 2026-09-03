/** Auto-title from the first user message in a thread. */
export function engineerThreadTitleFromContent(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New chat";
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}

/** How much of the Engineer's last answer the history card previews. */
const ANSWER_PREVIEW_CHARS = 150;

/**
 * A plain-text taste of an ENGINEER reply for the history card (2026-08-20, back with the old
 * page's look on 2026-09-03).
 *
 * Everything markdown-shaped comes out. The transcript renders through `EngineerMarkdown`, so a
 * reply arrives full of headings, bullets, bold lever names and the occasional table, and a
 * preview that showed `**Front droop**` or a leading `## ` would read as a bug.
 */
export function engineerAnswerPreviewFromContent(content: string): string | null {
  const plain = content
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
