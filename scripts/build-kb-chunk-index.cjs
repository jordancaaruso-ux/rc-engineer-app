#!/usr/bin/env node
/**
 * Build bag-of-words chunk index for vehicle-dynamics KB (Phase 6 embeddings prep).
 * Run: npm run kb:index
 */
const fs = require("node:fs/promises");
const path = require("node:path");

const KB_DIR = path.join(process.cwd(), "content", "vehicle-dynamics");
const OUT = path.join(KB_DIR, ".chunk-index.json");

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_\-+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function chunkDir(dir, sourcePrefix, chunks) {
  let files;
  try {
    files = (await fs.readdir(dir)).filter(
      (f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md"
    );
  } catch {
    return; // dir may not exist (e.g. no concepts/ yet)
  }

  for (const file of files.sort()) {
    const sourcePath = `${sourcePrefix}${file}`;
    const body = await fs.readFile(path.join(dir, file), "utf8");
    const sections = body.split(/^## /m);
    const preamble = sections.shift() ?? "";
    const fileTitle =
      preamble.match(/^#\s+(.+)$/m)?.[1]?.trim() || file.replace(/\.md$/, "");

    if (preamble.trim()) {
      chunks.push({
        sourcePath,
        title: fileTitle,
        sectionSlug: "intro",
        excerpt: preamble.trim().slice(0, 480),
        tokens: [...new Set(tokenize(preamble))],
      });
    }

    for (const section of sections) {
      const nl = section.indexOf("\n");
      const heading = (nl >= 0 ? section.slice(0, nl) : section).trim();
      const content = nl >= 0 ? section.slice(nl + 1) : "";
      if (!heading) continue;
      chunks.push({
        sourcePath,
        title: `${fileTitle} — ${heading}`,
        sectionSlug: slugify(heading),
        excerpt: content.trim().slice(0, 480),
        tokens: [...new Set(tokenize(`${heading} ${content}`))],
      });
    }
  }
}

async function main() {
  const chunks = [];
  // Top-level parameter files, then the founder-tier concept layer (subfolder — readdir is
  // non-recursive, so it must be walked explicitly).
  await chunkDir(KB_DIR, "", chunks);
  await chunkDir(path.join(KB_DIR, "concepts"), "concepts/", chunks);

  await fs.writeFile(
    OUT,
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), chunks }, null, 2),
    "utf8"
  );
  console.log(`Wrote ${chunks.length} KB chunks to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
