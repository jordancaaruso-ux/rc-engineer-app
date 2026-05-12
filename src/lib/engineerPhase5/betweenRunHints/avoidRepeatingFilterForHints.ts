import type { EngineerSetupChangeRow } from "@/lib/engineerPhase5/engineerRunSummaryTypes";

/**
 * Strips templated / redundant "avoid repeating" lines so the panel stays quiet unless the line adds specificity.
 */
export function filterAvoidRepeatingForBetweenRunHints(params: {
  text: string | null;
  setupChanges: EngineerSetupChangeRow[];
  headline: string;
  bullets: string[];
}): string | null {
  const t = params.text?.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (/^do not repeat\b/i.test(t)) return null;
  if (/^avoid stacking\b/i.test(t)) return null;
  if (/until you confirm pace\b/i.test(lower) && /stack|direction/i.test(lower)) return null;
  if (/^if the car felt worse after those adjustments\b/i.test(t)) return null;

  const labels = params.setupChanges.map((c) => c.label.toLowerCase());
  const keys = params.setupChanges.map((c) => c.key.toLowerCase());
  const tokens = [...labels, ...keys]
    .flatMap((s) => s.split(/[^a-z0-9%]+/g))
    .filter((w) => w.length >= 3);
  const mentionsDocumentedChange = tokens.some((tok) => lower.includes(tok));
  if (!mentionsDocumentedChange && t.length > 60) return null;

  const blob = `${params.headline} ${params.bullets.join(" ")}`.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 4);
  if (words.length >= 3) {
    const hits = words.filter((w) => blob.includes(w));
    if (hits.length >= words.length * 0.7 && t.length < 160) return null;
  }

  return t.length > 400 ? `${t.slice(0, 399)}…` : t;
}

/** Rebuild minimal rows from recent-session setup lines for client-side filtering of cached payloads. */
export function pseudoSetupChangesFromSessionLines(lines: string[]): EngineerSetupChangeRow[] {
  return lines.map((line, i) => {
    const label = line.includes(":") ? (line.split(":")[0]?.trim() ?? line) : line.trim();
    return {
      key: `hint_line_${i}`,
      label: label || line,
      before: "",
      after: "",
      rankReason: "",
      severity: "minor",
    };
  });
}
