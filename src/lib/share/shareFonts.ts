import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The shared pictures' type: Sora, in the four weights the app itself loads, plus Barlow Condensed
 * for the story looks.
 *
 * Sora is the app's voice (JetBrains Mono deleted 2026-08-14, Space Grotesk 2026-09-05) and draws the
 * paper info card. The story looks are the one place a second face is allowed: tall condensed sports
 * type, after the Arccos posts the founder sent (round 3 of the share interview, 2026-09-25: "tall
 * sports type on stories, the app's fonts everywhere else"). Barlow Condensed is SIL OFL.
 *
 * TTF, not WOFF2. `next/font/google` hands the browser woff2, which satori cannot parse at all —
 * so the app's own font pipeline is no help here and the files are vendored under `./fonts`.
 *
 * **Read off disk, and therefore listed in `outputFileTracingIncludes`** for `/api/runs/**` and
 * `/api/setup-snapshots/**` in `next.config.mjs`. Next's tracer follows imports, not
 * `readFileSync` paths, so without those entries the files would simply not be in the deployment
 * and every share would 500 — on Vercel only. Two production outages have already come from a
 * file the tracer could not see (see CLAUDE.md); check the routes' `.nft.json` after a build
 * rather than trusting that this still works.
 *
 * Read once per lambda and memoised; the files never change between deploys.
 */

export type FontWeight = 400 | 500 | 600 | 700 | 800;

type LoadedFont = {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: "normal";
};

const DIR = path.join(process.cwd(), "src", "lib", "share", "fonts");

const FILES: { name: string; weight: FontWeight; file: string }[] = [
  { name: "Sora", weight: 400, file: "Sora-Regular.ttf" },
  { name: "Sora", weight: 500, file: "Sora-Medium.ttf" },
  { name: "Sora", weight: 600, file: "Sora-SemiBold.ttf" },
  { name: "Sora", weight: 700, file: "Sora-Bold.ttf" },
  { name: "Barlow Condensed", weight: 600, file: "BarlowCondensed-SemiBold.ttf" },
  { name: "Barlow Condensed", weight: 700, file: "BarlowCondensed-Bold.ttf" },
  { name: "Barlow Condensed", weight: 800, file: "BarlowCondensed-ExtraBold.ttf" },
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

/** The families, as satori sees them. */
export const FONT_UI = "Sora";
export const FONT_STORY = "Barlow Condensed";
