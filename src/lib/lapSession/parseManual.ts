/**
 * Parse pasted lap text: newlines, commas, and/or whitespace separators.
 * Examples: "12.341\n12.298" | "12.341, 12.298, 12.410" | "12.341 12.298  12.410"
 */
export function parseManualLapText(text: string): number[] {
  const normalized = text.replace(/,/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized
    .split(/[\s\n]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => Number(p)).filter((n) => Number.isFinite(n));
}
