import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The shared pictures' one voice: Sora, in the four weights the app itself loads.
 *
 * One face, as in the app (JetBrains Mono deleted 2026-08-14, Space Grotesk 2026-09-05). The
 * pictures carried both until the paper redesign of 2026-09-25, which drew them in Sora only.
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

/** The family, as satori sees it. */
export const FONT_UI = "Sora";
