/** Auto-title from the first user message in a thread. */
export function engineerThreadTitleFromContent(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New chat";
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine;
}
