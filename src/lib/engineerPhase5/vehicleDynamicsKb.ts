import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");

export type VehicleDynamicsKbSnippet = {
  /** File path relative to content/vehicle-dynamics */
  sourcePath: string;
  /** First heading or filename */
  title: string;
  excerpt: string;
};

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_\-+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreText(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (lower.includes(t)) s += 1;
  }
  return s;
}

/**
 * Keyword search over markdown files in `content/vehicle-dynamics/`.
 * Sections split on `##` headings; scores by token overlap with the query.
 */
export async function searchVehicleDynamicsKb(
  query: string,
  limit: number
): Promise<VehicleDynamicsKbSnippet[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  let files: string[] = [];
  try {
    files = (await fs.readdir(KB_DIR)).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }

  const scored: Array<{ score: number; snippet: VehicleDynamicsKbSnippet }> = [];

  for (const file of files) {
    const full = path.join(KB_DIR, file);
    let raw = "";
    try {
      raw = await fs.readFile(full, "utf8");
    } catch {
      continue;
    }
    const chunks: Array<{ title: string; body: string }> = [];
    if (/\n##\s/.test(raw)) {
      const parts = raw.split(/\n(?=##\s)/);
      for (const part of parts) {
        const lines = part.trim().split("\n");
        const titleLine = lines[0]?.replace(/^#+\s*/, "").trim() || file;
        const body = lines.slice(1).join("\n").trim();
        chunks.push({ title: titleLine, body });
      }
    } else {
      chunks.push({ title: file.replace(/\.md$/i, ""), body: raw.trim() });
    }
    for (const { title, body } of chunks) {
      const text = `${title}\n${body}`;
      const sc = scoreText(text, tokens);
      if (sc <= 0) continue;
      const excerpt = text.length > 900 ? `${text.slice(0, 897)}…` : text;
      scored.push({
        score: sc,
        snippet: {
          sourcePath: `vehicle-dynamics/${file}`,
          title: title.length > 80 ? `${title.slice(0, 77)}…` : title,
          excerpt,
        },
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.snippet);
}
