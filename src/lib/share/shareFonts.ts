import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The card's real voices.
 *
 * Until 2026-08-13 the renderer used the single bundled Geist weight that ships inside
 * `next/dist/compiled/@vercel/og`. One weight means `fontWeight: 700` renders identically to 400 —
 * so every "bold" in the design was a lie and hierarchy had to be carried by size and colour alone.
 * These seven files are what make the weights in `renderRunCard.tsx` mean anything.
 *
 * TTF, not WOFF2. `next/font/google` hands the browser woff2, which satori cannot parse at all —
 * so the app's own font pipeline is no help here and the files are vendored under `./fonts`.
 *
 * **Read off disk, and therefore listed in `outputFileTracingIncludes`** against
 * `src/app/api/runs/[id]/share-card/route.tsx` in `next.config.mjs`. Next's tracer follows imports,
 * not `readFileSync` paths, so without that entry the files simply would not be in the deployment
 * and every share would 500 — on Vercel only. Two production outages have already come from a file
 * the tracer could not see (see CLAUDE.md); check the route's `.nft.json` after a build rather than
 * trusting that this still works. `fetch(new URL(…, import.meta.url))` is the other candidate and
 * was tried first: Node's fetch refuses `file://` URLs outright.
 *
 * Read once per lambda and memoised — a ~480KB read on every share would otherwise be paid per
 * request, and the files never change between deploys.
 */

type LoadedFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

const DIR = path.join(process.cwd(), "src", "lib", "share", "fonts");

const FILES: { name: string; weight: 400 | 500 | 600 | 700; file: string }[] = [
  { name: "Sora", weight: 400, file: "Sora-Regular.ttf" },
  { name: "Sora", weight: 500, file: "Sora-Medium.ttf" },
  { name: "Sora", weight: 600, file: "Sora-SemiBold.ttf" },
  { name: "Sora", weight: 700, file: "Sora-Bold.ttf" },
  { name: "JetBrains Mono", weight: 400, file: "JetBrainsMono-Regular.ttf" },
  { name: "JetBrains Mono", weight: 500, file: "JetBrainsMono-Medium.ttf" },
  { name: "Space Grotesk", weight: 700, file: "SpaceGrotesk-Bold.ttf" },
];

let cached: LoadedFont[] | null = null;

export function shareCardFonts(): LoadedFont[] {
  cached ??= FILES.map((f) => ({
    name: f.name,
    data: readFileSync(path.join(DIR, f.file)),
    weight: f.weight,
    style: "normal" as const,
  }));
  return cached;
}

/** The three families, as satori sees them. Used by the renderer's style objects. */
export const FONT_UI = "Sora";
export const FONT_DATA = "JetBrains Mono";
export const FONT_DISPLAY = "Space Grotesk";
