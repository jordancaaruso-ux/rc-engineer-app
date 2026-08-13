/**
 * KB coverage manifest — a compact, ground-truth listing of what the approved KB actually
 * covers (one line per file: sections + canonical keys).
 *
 * The eval harness's physics gate uses it to separate "the model reasoned badly over
 * knowledge it HAD" from "the KB simply didn't cover this topic" — an answer outside
 * coverage is logged, never failed (docs/ENGINEER_NORTH_STAR.md).
 *
 * Pure (no fs / no server-only) so it unit-tests: callers read the files and pass content in.
 */

/** Section headings + canonical key tokens extracted from one KB markdown file. */
export type KbFileTopics = {
  file: string;
  headings: string[];
  keys: string[];
};

const HEADING_RE = /^##\s+(.+?)\s*$/gm;
// Matches a "**Keys:**" / "**Key:**" / "**Keys (examples):**" line — the KB convention
// for canonical setup-key tokens (backtick-wrapped, snake_case).
const KEY_LINE_RE = /\*\*Keys?(?:\s*\([^)]*\))?:\*\*/;
const BACKTICK_TOKEN_RE = /`([^`]+)`/g;

export function parseKbTopics(file: string, content: string): KbFileTopics {
  const headings: string[] = [];
  for (const m of content.matchAll(HEADING_RE)) {
    const h = m[1].replace(/#+$/, "").trim();
    if (h) headings.push(h);
  }
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    if (!KEY_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(BACKTICK_TOKEN_RE)) {
      const tok = m[1].trim();
      // Key tokens are snake_case setup keys; skip prose backticks (spaces, .md refs).
      if (tok && !tok.includes(" ") && !tok.endsWith(".md")) keys.add(tok);
    }
  }
  return { file, headings, keys: [...keys] };
}

/**
 * Build the compact manifest string the classifier reads as ground truth. One line per
 * file: `file — sections: A | B — keys: k1, k2`. Small (~16 lines for the current KB).
 */
export function buildKbCoverageManifest(files: Array<{ file: string; content: string }>): string {
  const lines = files
    .map((f) => parseKbTopics(f.file, f.content))
    .filter((t) => t.headings.length > 0 || t.keys.length > 0)
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((t) => {
      const sections = t.headings.length ? `sections: ${t.headings.join(" | ")}` : "sections: (single)";
      const keys = t.keys.length ? ` — keys: ${t.keys.join(", ")}` : "";
      return `${t.file} — ${sections}${keys}`;
    });
  return lines.join("\n");
}
